import { EventEmitter } from 'events';

export interface AIEmbeddingGeneratedEvent {
  userId: string;
  documentId?: string;
  model: string;
  tokensUsed: number;
  costUsd: number;
  cached: boolean;
}

export interface AITokenUsageEvent {
  userId: string;
  model: string;
  tokensUsed: number;
  costUsd: number;
  operation: 'embedding' | 'chat' | 'completion';
  cached: boolean;
}

// Create a global event emitter for AI-related events
export const appEvents = new EventEmitter();

// Emit embedding generation events for cost tracking
export function emitEmbeddingGenerated(event: AIEmbeddingGeneratedEvent) {
  appEvents.emit('ai:embedding-generated', event);
}

// Emit general AI token usage events
export function emitTokenUsage(event: AITokenUsageEvent) {
  appEvents.emit('ai:token-usage', event);
}

// Listen to AI events for logging and analytics
appEvents.on('ai:embedding-generated', (event: AIEmbeddingGeneratedEvent) => {
  console.log('🤖 AI Embedding Generated:', {
    userId: event.userId,
    documentId: event.documentId,
    model: event.model,
    tokensUsed: event.tokensUsed,
    costUsd: `$${event.costUsd.toFixed(6)}`,
    cached: event.cached
  });
});

appEvents.on('ai:token-usage', (event: AITokenUsageEvent) => {
  console.log('💰 AI Token Usage:', {
    userId: event.userId,
    model: event.model,
    operation: event.operation,
    tokensUsed: event.tokensUsed,
    costUsd: `$${event.costUsd.toFixed(6)}`,
    cached: event.cached
  });
});
