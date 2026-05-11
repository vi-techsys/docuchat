import { openaiWithBreaker } from '../lib/http/openai.breaker';
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

const CHAT_MODEL = 'gpt-4o';
const DEFAULT_TEMPERATURE = 0.1; // Low temperature for factual answers
const DEFAULT_MAX_TOKENS = 1500;
const GPT_4O_INPUT_COST_PER_1M = 2.50; // $2.50 per 1M input tokens
const GPT_4O_OUTPUT_COST_PER_1M = 10.00; // $10.00 per 1M output tokens

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
    const messages: any[] = [
      { role: 'system', content: RAG_SYSTEM_PROMPT },
    ];

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
      messages[0] = { role: 'system', content: RAG_NO_CONTEXT_PROMPT };
      messages.push({
        role: 'user',
        content: [
          'No relevant context was found in my documents for this question.',
          '',
          `My question: ${question}`,
        ].join('\n'),
      });
    }

    customLogger.info('Generating RAG response', {
      correlationId,
      conversationId,
      model: CHAT_MODEL,
      contextChunks: context.chunks.length,
      contextTokens: context.totalTokens,
      hasConversationHistory: conversationHistory && conversationHistory.length > 0,
      temperature
    });

    // Call the LLM through the circuit breaker
    const response = await openaiWithBreaker.chatCompletion(messages, {
      model: CHAT_MODEL,
      temperature,
      max_tokens: maxTokens,
    });

    const result = response.data;
    const answer = result.choices[0].message.content || '';
    const usage = result.usage;
    const duration = Date.now() - startTime;

    // Calculate cost (GPT-4o pricing)
    const costUsd =
      (usage.prompt_tokens / 1_000_000) * GPT_4O_INPUT_COST_PER_1M +
      (usage.completion_tokens / 1_000_000) * GPT_4O_OUTPUT_COST_PER_1M;

    customLogger.info('RAG response generated successfully', {
      correlationId,
      conversationId,
      model: CHAT_MODEL,
      contextChunks: context.chunks.length,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      costUsd: costUsd.toFixed(6),
      durationMs: duration,
      answerLength: answer.length
    });

    return {
      answer,
      citations: context.citations,
      tokensUsed: {
        prompt: usage.prompt_tokens,
        completion: usage.completion_tokens,
        total: usage.total_tokens,
      },
      costUsd,
      model: CHAT_MODEL,
      processingTime: duration
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    customLogger.error('RAG response generation failed', {
      correlationId,
      conversationId,
      model: CHAT_MODEL,
      error: error instanceof Error ? error.message : 'Unknown error',
      durationMs: duration,
      contextChunks: context.chunks.length
    });

    // Return a fallback response
    return {
      answer: 'I apologize, but I encountered an error while processing your question. Please try again later.',
      citations: [],
      tokensUsed: { prompt: 0, completion: 0, total: 0 },
      costUsd: 0,
      model: CHAT_MODEL,
      processingTime: duration
    };
  }
}

export async function generateConversationSummary(
  conversationHistory: ConversationMessage[],
  correlationId: string = 'unknown'
): Promise<string> {
  const startTime = Date.now();

  try {
    const conversationText = conversationHistory
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');

    const response = await openaiWithBreaker.chatCompletion([
      {
        role: 'system',
        content: 'You are a helpful assistant that summarizes conversations concisely.'
      },
      {
        role: 'user',
        content: `Summarize the following conversation in 2-3 sentences, focusing on the main topics and questions discussed:\n\n${conversationText}\n\nSummary:`
      }
    ], {
      model: CHAT_MODEL,
      temperature: 0.3,
      max_tokens: 150
    });

    const summary = response.data.choices[0].message.content || '';
    const duration = Date.now() - startTime;

    customLogger.info('Conversation summary generated', {
      correlationId,
      conversationLength: conversationHistory.length,
      summaryLength: summary.length,
      durationMs: duration
    });

    return summary;

  } catch (error) {
    const duration = Date.now() - startTime;
    customLogger.error('Conversation summary generation failed', {
      correlationId,
      error: error instanceof Error ? error.message : 'Unknown error',
      durationMs: duration
    });

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
