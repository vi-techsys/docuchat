import { TOOL_REGISTRY, getToolSchemas } from './tools/registry';
import { openaiWithBreaker } from '../lib/http/openai.breaker';
import { customLogger } from '../lib/logger';
import { appEvents } from '../lib/events';
import { AGENT_SYSTEM_PROMPT } from '../config/prompts';

interface AgentConfig {
  maxIterations: number;
  timeoutMs: number;
  costCeilingUsd: number;
  model: string;
}

interface AgentResult {
  answer: string;
  sources: string[];
  confidence: string;
  iterations: number;
  costUsd: number;
  terminationReason: 'completed' | 'iteration_limit' | 'timeout' | 'cost_limit' | 'error';
  trace: TraceStep[];
}

interface TraceStep {
  step: number;
  phase: 'think' | 'act' | 'observe';
  tool?: string;
  input?: any;
  output?: any;
  durationMs: number;
  costUsd: number;
}

const DEFAULT_CONFIG: AgentConfig = {
  maxIterations: 10,
  timeoutMs: 60_000,
  costCeilingUsd: 0.50,
  model: 'gpt-4o',
};

export async function runAgent(options: {
  question: string;
  userId: string;
  correlationId: string;
  config?: Partial<AgentConfig>;
}): Promise<AgentResult> {
  const config = { ...DEFAULT_CONFIG, ...options.config };
  const { question, userId, correlationId } = options;

  const trace: TraceStep[] = [];
  let totalCostUsd = 0;
  let iteration = 0;
  const startTime = Date.now();

  // Build initial conversation with LLM
  const messages: any[] = [
    { role: 'system', content: AGENT_SYSTEM_PROMPT },
    { role: 'user', content: question },
  ];

  const toolSchemas = getToolSchemas();

  customLogger.info('Agent started', {
    correlationId, 
    question: question.substring(0, 100),
    maxIterations: config.maxIterations,
    costCeiling: config.costCeilingUsd,
  });

  appEvents.emitAgentEvent({
    type: 'agent_started',
    data: { question, config },
    correlationId,
    userId
  });

  while (iteration < config.maxIterations) {
    // ── CHECK TIMEOUT ──
    const elapsed = Date.now() - startTime;
    if (elapsed > config.timeoutMs) {
      customLogger.warn('Agent timeout', { correlationId, iteration, elapsed });
      appEvents.emitAgentEvent({
        type: 'agent_timeout',
        data: { elapsed, iterations: iteration },
        correlationId,
        userId
      });
      return buildResult('timeout', trace, totalCostUsd, iteration);
    }

    // ── CHECK COST ──
    if (totalCostUsd >= config.costCeilingUsd) {
      customLogger.warn('Agent cost ceiling hit', {
        correlationId, iteration, totalCostUsd,
      });
      appEvents.emitAgentEvent({
        type: 'agent_cost_limit',
        data: { totalCostUsd, iterations: iteration },
        correlationId,
        userId
      });
      return buildResult('cost_limit', trace, totalCostUsd, iteration);
    }

    iteration++;
    const stepStart = Date.now();

    // ── THINK: Ask model what to do ──
    const response = await openaiWithBreaker.chatCompletion(
      messages,
      {
        tools: toolSchemas,
        tool_choice: 'auto',
        model: config.model,
        temperature: 0.1,
      }
    );

    const usage = response.data.usage;
    const stepCost =
      (usage.prompt_tokens / 1_000_000) * 2.50 +
      (usage.completion_tokens / 1_000_000) * 10.00;
    totalCostUsd += stepCost;

    const choice = response.data.choices[0];
    const assistantMessage = choice.message;

    // Add the assistant's response to conversation
    messages.push(assistantMessage);

    // ── NO TOOL CALL: Model wants to respond directly ──
    if (!assistantMessage.tool_calls ||
        assistantMessage.tool_calls.length === 0) {
      trace.push({
        step: iteration, phase: 'think',
        output: assistantMessage.content,
        durationMs: Date.now() - stepStart, costUsd: stepCost,
      });

      // Treat direct response as final answer
      const result = {
        answer: assistantMessage.content || '',
        sources: [],
        confidence: 'medium',
        iterations: iteration,
        totalCostUsd,
        terminationReason: 'completed',
        trace,
      };

      appEvents.emitAgentEvent({
        type: 'agent_completed',
        data: result,
        correlationId,
        userId
      });

      return result;
    }

    // ── ACT: Execute each tool call ──
    for (const toolCall of assistantMessage.tool_calls) {
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments);

      customLogger.info('Agent tool call', {
        correlationId, iteration, tool: toolName,
        args: toolArgs,
      });

      appEvents.emitAgentEvent({
        type: 'tool_called',
        data: { tool: toolName, args: toolArgs },
        correlationId,
        userId
      });

      // Validate: is this tool in the registry?
      const tool = TOOL_REGISTRY[toolName];
      if (!tool) {
        const errorResult = {
          role: 'tool' as const,
          tool_call_id: toolCall.id,
          content: `Error: unknown tool "${toolName}"`,
        };
        messages.push(errorResult);
        trace.push({
          step: iteration, phase: 'act', tool: toolName,
          input: toolArgs,
          output: { error: 'Unknown tool' },
          durationMs: Date.now() - stepStart, costUsd: stepCost,
        });
        continue;
      }

      // Validate inputs
      const validation = tool.parameters.safeParse(toolArgs);
      if (!validation.success) {
        const errorResult = {
          role: 'tool' as const,
          tool_call_id: toolCall.id,
          content: `Validation error: ${validation.error.message}`,
        };
        messages.push(errorResult);
        trace.push({
          step: iteration, phase: 'act', tool: toolName,
          input: toolArgs,
          output: { error: validation.error.message },
          durationMs: Date.now() - stepStart, costUsd: stepCost,
        });
        continue;
      }

      // Execute the tool
      try {
        const result = await tool.handler(
          validation.data,
          { userId, correlationId: `${correlationId}-${toolName}` }
        );

        // ── OBSERVE: Feed result back to model ──
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result.data),
        });

        trace.push({
          step: iteration, phase: 'observe', tool: toolName,
          input: toolArgs, output: result.data,
          durationMs: Date.now() - stepStart, costUsd: stepCost,
        });
      } catch (error) {
        appEvents.emitAgentEvent({
          type: 'tool_error',
          data: { tool: toolName, error: (error as Error).message },
          correlationId,
          userId
        });

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Tool error: ${(error as Error).message}`,
        });
        trace.push({
          step: iteration, phase: 'observe', tool: toolName,
          input: toolArgs,
          output: { error: (error as Error).message },
          durationMs: Date.now() - stepStart, costUsd: stepCost,
        });
      }
    }

    // Continue to next iteration if tools were called
    // This allows the model to think about tool results and decide next action
  }

  // Iteration limit reached
  customLogger.warn('Agent iteration limit', {
    correlationId, iterations: iteration, totalCostUsd,
  });
  
  appEvents.emitAgentEvent({
    type: 'agent_iteration_limit',
    data: { iterations: iteration, totalCostUsd },
    correlationId,
    userId
  });

  return buildResult('iteration_limit', trace, totalCostUsd, iteration);
}

function buildResult(
  reason: AgentResult['terminationReason'],
  trace: TraceStep[],
  costUsd: number,
  iterations: number
): AgentResult {
  // Try to extract a partial answer from trace
  const lastObserve = [...trace]
    .reverse()
    .find(s => s.phase === 'observe' && s.output);

  return {
    answer: `I was unable to complete my analysis (${reason}). ` +
      (lastObserve
        ? 'Here is what I found so far: ' + JSON.stringify(lastObserve.output)
        : 'No partial results are available.'),
    sources: [],
    confidence: 'low',
    iterations,
    totalCostUsd: costUsd,
    terminationReason: reason,
    trace,
  };
}
