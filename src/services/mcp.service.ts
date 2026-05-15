import { openaiWithBreaker } from '../lib/http/openai.breaker';
import { customLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { emitTokenUsage } from '../events/ai.events';
import { recordDatabaseQuery } from '../lib/metrics';
import { cacheGet, cacheSet, cacheDel, CACHE_TTL } from '../lib/cache';

export type TaskType = 'chat' | 'embedding' | 'agent' | 'summary';

export interface MCPRequest {
  taskType: TaskType;
  messages: { role: string; content: string }[];
  userId: string;
  correlationId: string;
  tools?: any[];
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface MCPResponse {
  content: string;
  toolCalls?: any[];
  model: string;
  promptVersion: string;
  tokensUsed: { prompt: number; completion: number; total: number };
  costUsd: number;
  latencyMs: number;
  fallbackUsed: boolean;
  confidenceLevel?: 'high' | 'medium' | 'low';
}

export interface ModelConfig {
  name: string;
  costPerMillionInput: number;
  costPerMillionOutput: number;
  maxTokens: number;
}

const MODELS: Record<string, ModelConfig> = {
  'gpt-4o': {
    name: 'gpt-4o',
    costPerMillionInput: 2.50,
    costPerMillionOutput: 10.00,
    maxTokens: 128000,
  },
  'gpt-4o-mini': {
    name: 'gpt-4o-mini',
    costPerMillionInput: 0.15,
    costPerMillionOutput: 0.60,
    maxTokens: 128000,
  },
  'gpt-3.5-turbo': {
    name: 'gpt-3.5-turbo',
    costPerMillionInput: 0.50,
    costPerMillionOutput: 1.50,
    maxTokens: 16385,
  },
  'text-embedding-3-small': {
    name: 'text-embedding-3-small',
    costPerMillionInput: 0.02,
    costPerMillionOutput: 0,
    maxTokens: 8191,
  },
  'text-embedding-3-large': {
    name: 'text-embedding-3-large',
    costPerMillionInput: 0.13,
    costPerMillionOutput: 0,
    maxTokens: 8191,
  },
};

// Task type → default model mapping
const MODEL_ROUTING: Record<TaskType, string> = {
  chat: 'gpt-4o-mini',
  embedding: 'text-embedding-3-small',
  agent: 'gpt-4o',
  summary: 'gpt-4o-mini',
};

// Fallback chains for each model
const FALLBACK_CHAINS: Record<string, string[]> = {
  'gpt-4o': ['gpt-4o', 'gpt-4o-mini'],
  'gpt-4o-mini': ['gpt-4o-mini', 'gpt-4o'],
  'gpt-3.5-turbo': ['gpt-3.5-turbo', 'gpt-4o-mini'],
  'text-embedding-3-small': ['text-embedding-3-small', 'text-embedding-3-large'],
  'text-embedding-3-large': ['text-embedding-3-large', 'text-embedding-3-small'],
};

// Budget limits per user tier (USD per day)
const BUDGET_LIMITS: Record<string, number> = {
  free: 1.00,
  pro: 10.00,
  enterprise: 100.00,
};

/**
 * Step 1: Check budget enforcement
 */
async function enforceBudget(userId: string): Promise<void> {
  const startTime = Date.now();
  
  try {
    // Get user's tier
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tier: true },
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const dailyLimit = BUDGET_LIMITS[user.tier] || BUDGET_LIMITS.free;

    // Calculate today's cost for this user
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayUsage = await prisma.usageLog.aggregate({
      where: {
        userId,
        createdAt: { gte: today },
        cost: { not: null },
      },
      _sum: {
        cost: true,
      },
    });

    const todayCost = todayUsage._sum.cost || 0;

    if (todayCost >= dailyLimit) {
      throw new Error(`Daily budget exceeded for user ${userId}. Limit: $${dailyLimit.toFixed(2)}, Used: $${todayCost.toFixed(2)}`);
    }

    customLogger.info(`Budget check passed - userId: ${userId}, tier: ${user.tier}, dailyLimit: ${dailyLimit.toFixed(2)}, todayCost: ${todayCost.toFixed(2)}, remaining: ${(dailyLimit - todayCost).toFixed(2)}`);

    recordDatabaseQuery('select', 'users', 'success', Date.now() - startTime);
    recordDatabaseQuery('aggregate', 'usage_logs', 'success', Date.now() - startTime);

  } catch (error) {
    recordDatabaseQuery('select', 'users', 'error', Date.now() - startTime);
    throw error;
  }
}

/**
 * Step 2: Resolve prompt version
 */
async function resolvePrompt(taskType: TaskType): Promise<{ content: string; version: string }> {
  // Check cache first
  const cacheKey = `prompt:${taskType}:active`;
  const cached = await cacheGet(cacheKey) as { content: string; version: string } | null;
  if (cached) return cached;

  // Load from database
  const prompt = await prisma.promptTemplate.findFirst({
    where: { taskType, isActive: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!prompt) {
    throw new Error(`No active prompt for task type: ${taskType}`);
  }

  const result = { content: prompt.content, version: prompt.version };
  await cacheSet(cacheKey, result, 300); // Cache for 5 minutes
  return result;
}

/**
 * A/B testing: Resolve prompt with user-based split
 */
async function resolvePromptAB(
  taskType: TaskType,
  userId: string
): Promise<{ content: string; version: string }> {
  const prompts = await prisma.promptTemplate.findMany({
    where: { taskType, isActive: true },
    orderBy: { version: 'asc' },
  });

  if (prompts.length <= 1) {
    return resolvePrompt(taskType); // No A/B test running
  }

  // Deterministic split: hash the user ID to get a consistent bucket
  const hash = userId.charCodeAt(0) + userId.charCodeAt(userId.length - 1);
  const index = hash % prompts.length;

  const selected = prompts[index];
  return { content: selected.content, version: selected.version };
}

/**
 * Bust the prompt cache when activating a new prompt version
 */
export async function bustPromptCache(taskType: TaskType): Promise<void> {
  const cacheKey = `prompt:${taskType}:active`;
  await cacheDel(cacheKey);
  customLogger.info(`Prompt cache busted - taskType: ${taskType}`);
}

/**
 * Step 3: Route model selection
 */
async function routeModel(
  taskType: TaskType,
  messages: { role: string; content: string }[]
): Promise<ModelConfig> {
  const modelName = MODEL_ROUTING[taskType];
  return MODELS[modelName] || MODELS['gpt-4o-mini'];
}

/**
 * Step 4: Call with fallback
 */
async function callWithFallback(
  primaryModel: ModelConfig,
  request: MCPRequest
): Promise<{
  content: string;
  toolCalls?: any[];
  model: string;
  usage: { prompt: number; completion: number; total: number };
  fallbackUsed: boolean;
}> {
  const chain = FALLBACK_CHAINS[primaryModel.name] || [primaryModel.name];

  for (let i = 0; i < chain.length; i++) {
    const modelName = chain[i];
    const isFallback = i > 0;

    try {
      const result = await callModel(modelName, request);

      if (isFallback) {
        customLogger.warn(`Fallback model used - correlationId: ${request.correlationId}, primary: ${primaryModel.name}, fallback: ${modelName}`);
      }

      return {
        ...result,
        fallbackUsed: isFallback,
      };
    } catch (error) {
      customLogger.error(`Model ${modelName} failed - correlationId: ${request.correlationId}, error: ${error instanceof Error ? error.message : 'Unknown error'}, isLastFallback: ${i === chain.length - 1}`);

      if (i === chain.length - 1) {
        throw error; // All models failed
      }
      // Try next model in chain
    }
  }

  throw new Error('All models in fallback chain failed');
}

/**
 * Helper function to call a specific model
 */
async function callModel(
  model: string,
  request: MCPRequest
): Promise<{
  content: string;
  toolCalls?: any[];
  model: string;
  usage: { prompt: number; completion: number; total: number };
}> {
  const messages = request.systemPrompt
    ? [{ role: 'system', content: request.systemPrompt }, ...request.messages]
    : request.messages;

  if (model.includes('embedding')) {
    // Embedding call
    const text = request.messages[request.messages.length - 1]?.content || '';
    const response = await openaiWithBreaker.embeddings([text], { model });
    
    return {
      content: JSON.stringify(response.data.data[0].embedding),
      model,
      usage: {
        prompt: response.data.usage?.prompt_tokens || 0,
        completion: response.data.usage?.completion_tokens || 0,
        total: response.data.usage?.total_tokens || 0,
      },
    };
  } else {
    // Chat/completion call
    const response = await openaiWithBreaker.chatCompletion(messages, {
      model,
      temperature: request.temperature || 0.1,
      max_tokens: request.maxTokens || 1500,
      tools: request.tools,
      tool_choice: request.tools ? 'auto' : undefined,
    });

    const message = response.data.choices[0].message;
    
    return {
      content: message.content || '',
      toolCalls: message.tool_calls,
      model,
      usage: {
        prompt: response.data.usage?.prompt_tokens || 0,
        completion: response.data.usage?.completion_tokens || 0,
        total: response.data.usage?.total_tokens || 0,
      },
    };
  }
}

/**
 * Step 5: Calculate and track cost
 */
function calculateCost(modelName: string, usage: { prompt: number; completion: number; total: number }): number {
  const model = MODELS[modelName];
  if (!model) {
    // Default pricing if model not found
    return usage.total * 0.0000025;
  }

  return (
    (usage.prompt / 1_000_000) * model.costPerMillionInput +
    (usage.completion / 1_000_000) * model.costPerMillionOutput
  );
}

async function trackCost(userId: string, costUsd: number): Promise<void> {
  // Emit event for cost tracking
  emitTokenUsage({
    userId,
    model: 'unknown', // Will be set by caller
    tokensUsed: 0, // Will be set by caller
    costUsd,
    operation: 'chat',
    cached: false,
  });

  customLogger.info(`Cost tracked - userId: ${userId}, costUsd: ${costUsd.toFixed(6)}`);
}

/**
 * Step 6: Audit log
 */
async function auditLog(data: {
  taskType: TaskType;
  userId: string;
  correlationId: string;
  model: string;
  promptVersion: string;
  costUsd: number;
  latencyMs: number;
  messages?: any[];
  response?: string;
  fallbackUsed?: boolean;
  usage?: { prompt: number; completion: number; total: number };
}): Promise<void> {
  try {
    const inputText = data.messages
      ? data.messages.map(m => `[${m.role}]: ${m.content}`).join('\n')
      : '';

    await prisma.aIAuditLog.create({
      data: {
        userId: data.userId,
        correlationId: data.correlationId,
        taskType: data.taskType,
        model: data.model,
        promptVersion: data.promptVersion,
        inputTokens: data.usage?.prompt || 0,
        outputTokens: data.usage?.completion || 0,
        costUsd: data.costUsd,
        latencyMs: data.latencyMs,
        fallbackUsed: data.fallbackUsed ?? false,
        inputSummary: inputText.substring(0, 500),
        outputSummary: (data.response || '').substring(0, 500),
      },
    });

    customLogger.info(`Audit log created - userId: ${data.userId}, correlationId: ${data.correlationId}, taskType: ${data.taskType}, model: ${data.model}, promptVersion: ${data.promptVersion}, costUsd: ${data.costUsd.toFixed(6)}, latencyMs: ${data.latencyMs}`);
  } catch (error) {
    // Don't throw on audit log failure - it shouldn't break the flow
    customLogger.error(`Audit log creation failed - userId: ${data.userId}, correlationId: ${data.correlationId}, error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Calculate confidence level for chat tasks
 */
function calculateConfidenceLevel(
  taskType: TaskType,
  content: string,
  sources?: string[]
): 'high' | 'medium' | 'low' | undefined {
  if (taskType !== 'chat') {
    return undefined;
  }

  // Simple heuristic - in production, this would be more sophisticated
  const hasSources = sources && sources.length > 0;
  const hasUncertainty = content.toLowerCase().includes('uncertain') ||
                        content.toLowerCase().includes('not sure') ||
                        content.toLowerCase().includes('might be');
  
  if (hasSources && !hasUncertainty) {
    return 'high';
  } else if (hasSources || content.length > 100) {
    return 'medium';
  } else {
    return 'low';
  }
}

/**
 * Main MCP completion function - implements the 6-step pipeline
 */
export async function mcpComplete(
  request: MCPRequest
): Promise<MCPResponse> {
  const startTime = Date.now();

  try {
    customLogger.info(`MCP request started - correlationId: ${request.correlationId}, taskType: ${request.taskType}, userId: ${request.userId}, messageCount: ${request.messages.length}`);

    // Step 1: Check budget
    await enforceBudget(request.userId);

    // Step 2: Resolve prompt version (skip for embeddings - they don't need prompts)
    let prompt: { content: string; version: string };
    if (request.taskType === 'embedding') {
      prompt = { content: '', version: 'n/a' };
    } else {
      prompt = await resolvePrompt(request.taskType);
    }

    // Step 3: Select model
    const model = await routeModel(request.taskType, request.messages);

    // Step 4: Call with fallback
    const result = await callWithFallback(model, {
      ...request,
      systemPrompt: request.systemPrompt || prompt.content,
    });

    // Step 5: Track cost
    const costUsd = calculateCost(result.model, result.usage);
    await trackCost(request.userId, costUsd);

    // Step 6: Audit log
    await auditLog({
      ...request,
      model: result.model,
      promptVersion: prompt.version,
      costUsd,
      latencyMs: Date.now() - startTime,
      response: result.content,
      fallbackUsed: result.fallbackUsed,
      usage: result.usage,
    });

    // Calculate confidence level for chat tasks
    let confidenceLevel: 'high' | 'medium' | 'low' | undefined;
    if (request.taskType === 'chat') {
      confidenceLevel = calculateConfidenceLevel(request.taskType, result.content);
      
      // Track confidence level metric
      if (confidenceLevel) {
        customLogger.info(`Confidence level tracked - correlationId: ${request.correlationId}, taskType: ${request.taskType}, confidenceLevel: ${confidenceLevel}`);
      }
    }

    const latencyMs = Date.now() - startTime;

    customLogger.info(`MCP request completed - correlationId: ${request.correlationId}, taskType: ${request.taskType}, model: ${result.model}, promptVersion: ${prompt.version}, tokensUsed: ${result.usage.total}, costUsd: ${costUsd.toFixed(6)}, latencyMs: ${latencyMs}, fallbackUsed: ${result.fallbackUsed}, confidenceLevel: ${confidenceLevel}`);

    return {
      content: result.content,
      toolCalls: result.toolCalls,
      model: result.model,
      promptVersion: prompt.version,
      tokensUsed: result.usage,
      costUsd,
      latencyMs,
      fallbackUsed: result.fallbackUsed,
      confidenceLevel,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    
    customLogger.error(`MCP request failed - correlationId: ${request.correlationId}, taskType: ${request.taskType}, userId: ${request.userId}, error: ${error instanceof Error ? error.message : 'Unknown error'}, latencyMs: ${latencyMs}`);

    throw error;
  }
}
