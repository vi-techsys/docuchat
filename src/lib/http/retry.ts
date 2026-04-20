import { HttpError, RateLimitInfo } from './openai.client';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  jitter?: boolean;
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: HttpError;
  attempts: number;
  totalDelay: number;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  backoffFactor: 2,
  jitter: true,
};

/**
 * Determines if an error is retryable based on type and status code
 */
export function isRetryable(error: HttpError): boolean {
  // Network errors (no response) are typically retryable
  if (error.type === 'request') {
    return true;
  }

  // Setup errors are not retryable (bad configuration)
  if (error.type === 'setup') {
    return false;
  }

  // Response errors - check status codes
  if (error.type === 'response' && error.response) {
    const status = error.response.status;
    
    // Retryable status codes
    const retryableStatuses = [
      408, // Request Timeout
      429, // Too Many Requests (Rate Limited)
      500, // Internal Server Error
      502, // Bad Gateway
      503, // Service Unavailable
      504, // Gateway Timeout
    ];
    
    return retryableStatuses.includes(status);
  }

  // Default to not retryable for unknown error types
  return false;
}

/**
 * Calculates delay with exponential backoff and optional jitter
 */
function calculateDelay(attempt: number, options: Required<RetryOptions>): number {
  let delay = options.baseDelay * Math.pow(options.backoffFactor, attempt - 1);
  
  // Apply jitter to prevent thundering herd
  if (options.jitter) {
    delay = delay * (0.5 + Math.random() * 0.5);
  }
  
  // Cap at max delay
  return Math.min(delay, options.maxDelay);
}

/**
 * Honors Retry-After header if present in rate limit info
 */
function getRetryAfterDelay(error: HttpError): number | null {
  if (error.rateLimit?.retryAfter) {
    // Retry-After can be seconds or HTTP date
    const retryAfter = error.rateLimit.retryAfter;
    
    // If it's a number (seconds), convert to milliseconds
    if (typeof retryAfter === 'number') {
      return retryAfter * 1000;
    }
    
    // If it's a date string, calculate difference
    if (typeof retryAfter === 'string') {
      const retryDate = new Date(retryAfter);
      if (!isNaN(retryDate.getTime())) {
        return Math.max(0, retryDate.getTime() - Date.now());
      }
    }
  }
  
  return null;
}

/**
 * Sleep helper for delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry helper with exponential backoff and rate limit handling
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: HttpError | undefined;
  let totalDelay = 0;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      console.log(`🔄 Attempt ${attempt}/${opts.maxAttempts}...`);
      const result = await fn();
      
      if (attempt > 1) {
        console.log(`✅ Success on attempt ${attempt} after ${totalDelay}ms total delay`);
      }
      
      return {
        success: true,
        data: result,
        attempts: attempt,
        totalDelay,
      };
    } catch (error) {
      lastError = error as HttpError;
      
      console.error(`❌ Attempt ${attempt} failed:`, lastError.message);
      
      // Check if error is retryable
      if (!isRetryable(lastError)) {
        console.log(`🚫 Error is not retryable: ${lastError.type} ${lastError.response?.status || ''}`);
        break;
      }
      
      // If this is the last attempt, don't delay
      if (attempt === opts.maxAttempts) {
        console.log(`🚫 Max attempts (${opts.maxAttempts}) reached, giving up`);
        break;
      }
      
      // Calculate delay
      let delay = calculateDelay(attempt, opts);
      
      // Check for Retry-After header (rate limit)
      const retryAfterDelay = getRetryAfterDelay(lastError);
      if (retryAfterDelay !== null) {
        delay = Math.max(delay, retryAfterDelay);
        console.log(`⏰ Using Retry-After header: ${retryAfterDelay}ms`);
      }
      
      console.log(`⏳ Waiting ${Math.round(delay)}ms before retry...`);
      totalDelay += delay;
      await sleep(delay);
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: opts.maxAttempts,
    totalDelay,
  };
}

/**
 * Utility function to create a retryable wrapper for async functions
 */
export function createRetryable<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
) {
  return () => withRetry(fn, options);
}
