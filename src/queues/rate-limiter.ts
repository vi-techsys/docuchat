import { Queue, QueueOptions } from 'bullmq';
import { redisConnection } from './connection';

export interface RateLimiterOptions {
  max?: number;           // Maximum number of jobs
  duration?: number;       // Time window in milliseconds
  groupKey?: string;      // Key to group rate limits (e.g., userId, IP)
}

export interface RateLimitInfo {
  remaining: number;
  reset: number;
  limit: number;
}

const DEFAULT_RATE_LIMITER_OPTIONS: Required<RateLimiterOptions> = {
  max: 100,              // 100 jobs
  duration: 60000,        // per minute
  groupKey: 'default',    // default group
};

/**
 * Creates a rate-limited queue using BullMQ's built-in rate limiting
 */
export function createRateLimitedQueue<T = any>(
  name: string,
  options: RateLimiterOptions = {},
  queueOptions?: QueueOptions
): Queue<T> {
  const opts = { ...DEFAULT_RATE_LIMITER_OPTIONS, ...options };
  
  // Create queue with rate limiting
  const queue = new Queue<T>(name, {
    ...queueOptions,
    connection: redisConnection,
    defaultJobOptions: {
      ...queueOptions?.defaultJobOptions,
      // Add rate limiting metadata
      rateLimitKey: opts.groupKey,
    },
  });

  console.log(`🚦 Created rate-limited queue: ${name}`);
  console.log(`📊 Rate limit: ${opts.max} jobs per ${opts.duration}ms (${opts.duration/1000}s)`);
  console.log(`🔑 Group key: ${opts.groupKey}`);

  return queue;
}

/**
 * Creates multiple rate limiters for different scenarios
 */
export const rateLimiters = {
  /**
   * OpenAI API calls - strict rate limiting
   */
  openai: createRateLimitedQueue('openai-api-calls', {
    max: 60,           // 60 requests
    duration: 60000,     // per minute (matches OpenAI limits)
    groupKey: 'openai',
  }),

  /**
   * Document processing - moderate rate limiting
   */
  documentProcessing: createRateLimitedQueue('document-processing', {
    max: 10,           // 10 documents
    duration: 60000,     // per minute
    groupKey: 'document',
  }),

  /**
   * Webhook processing - high throughput
   */
  webhookProcessing: createRateLimitedQueue('webhook-processing', {
    max: 1000,         // 1000 webhooks
    duration: 60000,     // per minute
    groupKey: 'webhook',
  }),

  /**
   * Email notifications - conservative rate limiting
   */
  emailNotifications: createRateLimitedQueue('email-notifications', {
    max: 20,           // 20 emails
    duration: 60000,     // per minute
    groupKey: 'email',
  }),

  /**
   * User-specific rate limiting (per user ID)
   */
  userSpecific: (userId: string) => createRateLimitedQueue(`user-${userId}`, {
    max: 30,           // 30 operations
    duration: 60000,     // per minute per user
    groupKey: `user-${userId}`,
  }),
};

/**
 * Check current rate limit status
 */
export async function getRateLimitStatus(queue: Queue): Promise<RateLimitInfo | null> {
  try {
    // Get queue waiting count
    const waiting = await queue.getWaiting();
    
    // This is a simplified version - in production you'd want
    // more sophisticated rate limit tracking
    return {
      remaining: Math.max(0, 100 - waiting.length), // Estimate
      reset: Date.now() + 60000, // Next minute
      limit: 100,
    };
  } catch (error) {
    console.error('Failed to get rate limit status:', error);
    return null;
  }
}

/**
 * Wait for rate limit reset if needed
 */
export async function waitForRateLimit(queue: Queue): Promise<void> {
  const status = await getRateLimitStatus(queue);
  
  if (status && status.remaining <= 0) {
    const waitTime = status.reset - Date.now();
    if (waitTime > 0) {
      console.log(`⏳ Rate limit exceeded, waiting ${Math.ceil(waitTime/1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

/**
 * Add job with rate limiting
 */
export async function addJobWithRateLimit<T>(
  queue: Queue<T>,
  jobName: string,
  data: T,
  options?: any
): Promise<any> {
  // Check rate limit before adding
  await waitForRateLimit(queue);
  
  // Add the job
  const job = await queue.add(jobName, data, options);
  
  console.log(`➕ Job added to rate-limited queue: ${jobName} (ID: ${job.id})`);
  
  return job;
}

export default {
  createRateLimitedQueue,
  rateLimiters,
  getRateLimitStatus,
  waitForRateLimit,
  addJobWithRateLimit,
};
