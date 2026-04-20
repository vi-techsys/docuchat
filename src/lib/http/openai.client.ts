import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';

export interface OpenAIRequestConfig extends AxiosRequestConfig {
  service?: string;
}

export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  reset?: number;
  retryAfter?: number;
}

export interface HttpError extends Error {
  config?: OpenAIRequestConfig;
  code?: string;
  response?: AxiosResponse;
  isAxiosError?: boolean;
  type?: 'response' | 'request' | 'setup';
  rateLimit?: RateLimitInfo;
}

// Create OpenAI specific Axios instance
export const openaiClient: AxiosInstance = axios.create({
  baseURL: 'https://api.openai.com/v1',
  timeout: 30000, // 30 second timeout
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY || 'sk-test-placeholder-key'}`,
  },
});

// Request interceptor for logging and timing
openaiClient.interceptors.request.use(
  (config) => {
    const startTime = Date.now();
    (config as any).metadata = { startTime };
    
    console.log(`🌐 [${config.method?.toUpperCase()}] ${config.baseURL}${config.url}`);
    if (config.data) {
      console.log(`📤 Request body:`, JSON.stringify(config.data, null, 2));
    }
    
    return config;
  },
  (error) => {
    console.error('❌ Request setup error:', error.message);
    const httpError: HttpError = new Error(error.message) as HttpError;
    httpError.type = 'setup';
    httpError.config = error.config;
    throw httpError;
  }
);

// Response interceptor for logging, timing, and rate limit handling
openaiClient.interceptors.response.use(
  (response) => {
    const config = response.config as any;
    const startTime = config.metadata?.startTime;
    const duration = startTime ? Date.now() - startTime : 0;
    
    console.log(`✅ [${response.config.method?.toUpperCase()}] ${response.config.url} - ${response.status} (${duration}ms)`);
    
    // Extract rate limit headers
    const rateLimit: RateLimitInfo = {
      limit: response.headers['x-ratelimit-limit-requests'] 
        ? parseInt(response.headers['x-ratelimit-limit-requests']) 
        : undefined,
      remaining: response.headers['x-ratelimit-remaining-requests'] 
        ? parseInt(response.headers['x-ratelimit-remaining-requests']) 
        : undefined,
      reset: response.headers['x-ratelimit-reset-requests'] 
        ? parseInt(response.headers['x-ratelimit-reset-requests']) 
        : undefined,
      retryAfter: response.headers['retry-after'] 
        ? parseInt(response.headers['retry-after']) 
        : undefined,
    };
    
    // Warn when rate limit is low
    if (rateLimit.remaining !== undefined && rateLimit.remaining < 10) {
      console.warn(`⚠️ Rate limit running low: ${rateLimit.remaining}/${rateLimit.limit} requests remaining`);
      
      // Additional warnings at different thresholds
      if (rateLimit.remaining < 5) {
        console.warn(`🚨 CRITICAL: Only ${rateLimit.remaining} requests left!`);
      }
      
      if (rateLimit.remaining < 2) {
        console.error(`💥 URGENT: Rate limit will be exceeded on next request!`);
      }
    }
    
    // Log rate limit reset time
    if (rateLimit.reset !== undefined) {
      const resetTime = new Date(rateLimit.reset * 1000);
      const timeUntilReset = resetTime.getTime() - Date.now();
      
      if (timeUntilReset > 0) {
        const minutesUntilReset = Math.ceil(timeUntilReset / (1000 * 60));
        console.log(`⏰ Rate limit resets in ${minutesUntilReset} minutes (${resetTime.toISOString()})`);
      }
    }
    
    // Attach rate limit info to response for downstream use
    (response as any).rateLimit = rateLimit;
    
    return response;
  },
  (error) => {
    const httpError: HttpError = error as HttpError;
    
    if (axios.isAxiosError(error)) {
      httpError.isAxiosError = true;
      httpError.config = error.config;
      
      if (error.response) {
        // Server responded with error status
        httpError.type = 'response';
        httpError.response = error.response;
        httpError.code = error.code;
        
        // Extract rate limit headers from error response
        const rateLimit: RateLimitInfo = {
          limit: error.response.headers['x-ratelimit-limit-requests'] 
            ? parseInt(error.response.headers['x-ratelimit-limit-requests']) 
            : undefined,
          remaining: error.response.headers['x-ratelimit-remaining-requests'] 
            ? parseInt(error.response.headers['x-ratelimit-remaining-requests']) 
            : undefined,
          reset: error.response.headers['x-ratelimit-reset-requests'] 
            ? parseInt(error.response.headers['x-ratelimit-reset-requests']) 
            : undefined,
          retryAfter: error.response.headers['retry-after'] 
            ? parseInt(error.response.headers['retry-after']) 
            : undefined,
        };
        
        httpError.rateLimit = rateLimit;
        
        console.error(`❌ [${error.config?.method?.toUpperCase()}] ${error.config?.url} - ${error.response.status}`);
        console.error(`📄 Error response:`, error.response.data);
        
        if (rateLimit.remaining !== undefined && rateLimit.remaining === 0) {
          console.warn(`🚫 Rate limit exceeded. Reset at: ${new Date(rateLimit.reset! * 1000).toISOString()}`);
        }
      } else if (error.request) {
        // Request was made but no response received
        httpError.type = 'request';
        console.error(`❌ [${error.config?.method?.toUpperCase()}] ${error.config?.url} - No response received`);
        console.error(`📡 Network error:`, error.message);
      } else {
        // Error in request setup
        httpError.type = 'setup';
        console.error(`❌ Request setup error:`, error.message);
      }
    } else {
      // Non-axios error
      console.error(`❌ Unexpected error:`, error.message);
    }
    
    throw httpError;
  }
);

export default openaiClient;
