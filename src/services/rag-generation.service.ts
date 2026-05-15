import { mcpComplete, MCPRequest } from './mcp.service';
import { RAG_SYSTEM_PROMPT, RAG_NO_CONTEXT_PROMPT } from '../config/prompts';
import { customLogger } from '../lib/logger';
import { AssembledContext, Citation } from './context.service';

export interface RAGResponse {
  answer: string;
  citations: Citation[];
  tokensUsed: {
    prompt: number;
    completion: number;
    total: number;
  };
  costUsd: number;
  model: string;
  processingTime: number;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RAGGenerationOptions {
  question: string;
  context: AssembledContext;
  conversationHistory?: ConversationMessage[];
  userId: string;
  conversationId: string;
  correlationId?: string;
  temperature?: number;
  maxTokens?: number;
}

const DEFAULT_TEMPERATURE = 0.1; // Low temperature for factual answers
const DEFAULT_MAX_TOKENS = 1500;

export async function generateRAGResponse(options: RAGGenerationOptions): Promise<RAGResponse> {
  const {
    question,
    context,
    conversationHistory,
    userId,
    conversationId,
    correlationId = 'unknown',
    temperature = DEFAULT_TEMPERATURE,
    maxTokens = DEFAULT_MAX_TOKENS
  } = options;

  const startTime = Date.now();

  try {
    // Build the messages array
    const messages: any[] = [];

    // Add recent conversation history (last 5 exchanges = 10 messages)
    if (conversationHistory && conversationHistory.length > 0) {
      const recent = conversationHistory.slice(-10);
      messages.push(...recent);
    }

    // Add the context and question
    if (context.chunks.length > 0) {
      messages.push({
        role: 'user',
        content: [
          'Here is the relevant context from my documents:',
          '',
          context.contextText,
          '',
          '---',
          '',
          `My question: ${question}`,
        ].join('\n'),
      });
    } else {
      // No relevant context found
      messages.push({
        role: 'user',
        content: [
          'No relevant context was found in my documents for this question.',
          '',
          `My question: ${question}`,
        ].join('\n'),
      });
    }

    customLogger.info(`Generating RAG response - correlationId: ${correlationId}, conversationId: ${conversationId}, contextChunks: ${context.chunks.length}, contextTokens: ${context.totalTokens}, hasConversationHistory: ${conversationHistory && conversationHistory.length > 0}, temperature: ${temperature}`);

    // Determine system prompt based on context availability
    const systemPrompt = context.chunks.length > 0 ? RAG_SYSTEM_PROMPT : RAG_NO_CONTEXT_PROMPT;

    // Call MCP service
    const mcpRequest: MCPRequest = {
      taskType: 'chat',
      messages,
      userId,
      correlationId,
      systemPrompt,
      temperature,
      maxTokens,
    };

    const mcpResponse = await mcpComplete(mcpRequest);

    const duration = Date.now() - startTime;

    customLogger.info(`RAG response generated successfully - correlationId: ${correlationId}, conversationId: ${conversationId}, model: ${mcpResponse.model}, promptVersion: ${mcpResponse.promptVersion}, contextChunks: ${context.chunks.length}, promptTokens: ${mcpResponse.tokensUsed.prompt}, completionTokens: ${mcpResponse.tokensUsed.completion}, totalTokens: ${mcpResponse.tokensUsed.total}, costUsd: ${mcpResponse.costUsd.toFixed(6)}, durationMs: ${duration}, answerLength: ${mcpResponse.content.length}, fallbackUsed: ${mcpResponse.fallbackUsed}`);

    return {
      answer: mcpResponse.content,
      citations: context.citations,
      tokensUsed: mcpResponse.tokensUsed,
      costUsd: mcpResponse.costUsd,
      model: mcpResponse.model,
      processingTime: duration
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    customLogger.error(`RAG response generation failed - correlationId: ${correlationId}, conversationId: ${conversationId}, error: ${error instanceof Error ? error.message : 'Unknown error'}, durationMs: ${duration}, contextChunks: ${context.chunks.length}`);

    // Return a fallback response
    return {
      answer: 'I apologize, but I encountered an error while processing your question. Please try again later.',
      citations: [],
      tokensUsed: { prompt: 0, completion: 0, total: 0 },
      costUsd: 0,
      model: 'unknown',
      processingTime: duration
    };
  }
}

export async function generateConversationSummary(
  conversationHistory: ConversationMessage[],
  correlationId: string = 'unknown',
  userId: string = 'system'
): Promise<string> {
  const startTime = Date.now();

  try {
    const conversationText = conversationHistory
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');

    // Call MCP service
    const mcpRequest: MCPRequest = {
      taskType: 'summary',
      messages: [
        {
          role: 'user',
          content: `Summarize the following conversation in 2-3 sentences, focusing on the main topics and questions discussed:\n\n${conversationText}\n\nSummary:`
        }
      ],
      userId,
      correlationId,
      temperature: 0.3,
      maxTokens: 150,
    };

    const mcpResponse = await mcpComplete(mcpRequest);

    const summary = mcpResponse.content;
    const duration = Date.now() - startTime;

    customLogger.info(`Conversation summary generated - correlationId: ${correlationId}, conversationLength: ${conversationHistory.length}, summaryLength: ${summary.length}, durationMs: ${duration}, model: ${mcpResponse.model}, promptVersion: ${mcpResponse.promptVersion}`);

    return summary;

  } catch (error) {
    const duration = Date.now() - startTime;
    customLogger.error(`Conversation summary generation failed - correlationId: ${correlationId}, error: ${error instanceof Error ? error.message : 'Unknown error'}, durationMs: ${duration}`);

    return 'Conversation summary unavailable.';
  }
}

export function validateRAGResponse(response: RAGResponse): {
  isValid: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Check if answer is empty
  if (!response.answer || response.answer.trim().length === 0) {
    errors.push('Answer is empty');
  }

  // Check for reasonable answer length
  if (response.answer.length > 4000) {
    warnings.push('Answer is very long, may exceed user expectations');
  }

  // Check for cost limits
  if (response.costUsd > 0.50) {
    warnings.push(`High cost response: $${response.costUsd.toFixed(4)}`);
  }

  // Check for token usage
  if (response.tokensUsed.total > 4000) {
    warnings.push(`High token usage: ${response.tokensUsed.total} tokens`);
  }

  // Check processing time
  if (response.processingTime > 10000) {
    warnings.push(`Slow response: ${response.processingTime}ms`);
  }

  // Check if answer indicates no context was found
  if (response.answer.includes('couldn\'t find information') && response.citations.length > 0) {
    warnings.push('Answer claims no information but citations are present');
  }

  return {
    isValid: errors.length === 0,
    warnings,
    errors
  };
}
