import CircuitBreaker from 'opossum';
import { withRetry, RetryOptions } from './retry';
import { HttpError } from './openai.client';
import openaiClient from './openai.client';

export interface CircuitBreakerOptions {
  timeout?: number;
  errorThresholdPercentage?: number;
  resetTimeout?: number;
  retryOptions?: RetryOptions;
}

export interface CircuitBreakerState {
  open: boolean;
  closed: boolean;
  halfOpen: boolean;
  stats: {
    failures: number;
    fires: number;
    successes: number;
  };
}

const DEFAULT_CIRCUIT_BREAKER_OPTIONS: Required<CircuitBreakerOptions> = {
  timeout: 30000, // 30 seconds
  errorThresholdPercentage: 50, // 50% error rate triggers opening
  resetTimeout: 30000, // 30 seconds before trying again
  retryOptions: {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffFactor: 2,
    jitter: true,
  },
};

/**
 * Creates a circuit breaker wrapped OpenAI client function
 */
export function createOpenAICircuitBreaker<T = any>(
  apiCall: () => Promise<T>,
  options: CircuitBreakerOptions = {}
): CircuitBreaker<[], T> & { 
  execute: () => Promise<T>;
  getState: () => CircuitBreakerState;
  getStats: () => CircuitBreaker.Stats;
} {
  const opts = { ...DEFAULT_CIRCUIT_BREAKER_OPTIONS, ...options };
  
  // Create the circuit breaker
  const breaker = new CircuitBreaker(apiCall, {
    timeout: opts.timeout,
    errorThresholdPercentage: opts.errorThresholdPercentage,
    resetTimeout: opts.resetTimeout,
  });

  // Event listeners for monitoring
  breaker.on('open', () => {
    console.log('🔌 Circuit breaker OPENED - blocking requests');
    console.log('📊 Stats:', breaker.stats);
  });

  breaker.on('halfOpen', () => {
    console.log('🔓 Circuit breaker HALF-OPEN - allowing test requests');
  });

  breaker.on('close', () => {
    console.log('✅ Circuit breaker CLOSED - normal operation resumed');
    console.log('📊 Stats:', breaker.stats);
  });

  breaker.on('fallback', (result: unknown, err: Error) => {
    console.error('🚨 Circuit breaker FALLBACK triggered:', err.message);
  });

  breaker.on('reject', () => {
    console.warn('⚠️ Circuit breaker REJECTED request (breaker is open)');
  });

  breaker.on('timeout', (err: Error) => {
    console.error('⏱️ Circuit breaker TIMEOUT:', err.message);
  });

  breaker.on('success', (result: any) => {
    console.log('✅ Circuit breaker SUCCESS');
  });

  breaker.on('failure', (err: Error) => {
    console.error('❌ Circuit breaker FAILURE:', err.message);
  });

  // Enhanced execute method that includes retry logic
  const enhancedExecute = async (): Promise<T> => {
    // First, check if circuit breaker is open
    if (breaker.opened) {
      const error = new Error('Circuit breaker is open') as HttpError;
      error.type = 'response';
      throw error;
    }

    // Use retry logic within the circuit breaker
    const retryResult = await withRetry(
      () => breaker.fire() as Promise<T>,
      opts.retryOptions
    );

    if (!retryResult.success) {
      throw retryResult.error!;
    }

    return retryResult.data!;
  };

  // Return enhanced breaker
  const enhancedBreaker = breaker as CircuitBreaker<[], T> & { 
    execute: () => Promise<T>;
    getState: () => CircuitBreakerState;
    getStats: () => CircuitBreaker.Stats;
  };
  
  enhancedBreaker.execute = enhancedExecute;
  enhancedBreaker.getState = (): CircuitBreakerState => ({
    open: breaker.opened,
    closed: !breaker.opened && !breaker.halfOpen,
    halfOpen: breaker.halfOpen,
    stats: {
      failures: breaker.stats.failures,
      fires: breaker.stats.fires,
      successes: breaker.stats.successes,
    },
  });
  enhancedBreaker.getStats = () => breaker.stats;
  
  return enhancedBreaker;
}

/**
 * Common OpenAI API calls with circuit breaker protection
 */
export const openaiWithBreaker = {
  /**
   * Chat completion with circuit breaker
   */
  async chatCompletion(messages: any[], options?: any) {
    const breaker = createOpenAICircuitBreaker(
      () => openaiClient.post('/chat/completions', {
        model: options?.model || 'gpt-3.5-turbo',
        messages,
        ...options,
      }),
      {
        retryOptions: {
          maxAttempts: 3,
          baseDelay: 2000, // Longer delays for OpenAI
          maxDelay: 30000,
        },
      }
    );

    return breaker.execute();
  },

  /**
   * Embeddings with circuit breaker
   */
  async embeddings(input: string[], options?: any) {
    const breaker = createOpenAICircuitBreaker(
      () => openaiClient.post('/embeddings', {
        model: options?.model || 'text-embedding-ada-002',
        input,
        ...options,
      }),
      {
        retryOptions: {
          maxAttempts: 3,
          baseDelay: 2000,
          maxDelay: 30000,
        },
      }
    );

    return breaker.execute();
  },

  /**
   * Models list with circuit breaker
   */
  async listModels() {
    const breaker = createOpenAICircuitBreaker(
      () => openaiClient.get('/models'),
      {
        retryOptions: {
          maxAttempts: 2, // Fewer retries for simple GET
          baseDelay: 1000,
          maxDelay: 10000,
        },
      }
    );

    return breaker.execute();
  },
};

/**
 * Get current state of all OpenAI circuit breakers
 */
export function getCircuitBreakerStates(): Record<string, CircuitBreakerState> {
  // This would be implemented if we track multiple breakers
  // For now, return empty object
  return {};
}

export default openaiWithBreaker;
