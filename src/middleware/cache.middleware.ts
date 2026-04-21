import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export interface CacheOptions {
  maxAge?: number;        // Cache-Control max-age in seconds
  private?: boolean;      // Whether cache is private to user
  noStore?: boolean;      // Cache-Control: no-store
  noCache?: boolean;      // Cache-Control: no-cache
  etag?: boolean;         // Enable ETag generation
  vary?: string[];        // Vary header values
}

const DEFAULT_CACHE_OPTIONS: Required<CacheOptions> = {
  maxAge: 300,           // 5 minutes
  private: false,
  noStore: false,
  noCache: false,
  etag: true,
  vary: [],
};

/**
 * Generate ETag from response data
 */
function generateETag(data: any): string {
  const dataString = typeof data === 'string' ? data : JSON.stringify(data);
  const hash = crypto.createHash('md5').update(dataString).digest('hex');
  return `"${hash}"`;
}

/**
 * Check if ETag matches (for conditional requests)
 */
function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  
  // Handle multiple ETags (comma-separated)
  const etags = ifNoneMatch.split(',').map(etag => etag.trim());
  return etags.includes(etag) || etags.includes('*');
}

/**
 * Set Cache-Control headers
 */
function setCacheHeaders(res: Response, options: Required<CacheOptions>): void {
  const directives: string[] = [];
  
  if (options.noStore) {
    directives.push('no-store');
  } else {
    if (options.private) {
      directives.push('private');
    } else {
      directives.push('public');
    }
    
    directives.push(`max-age=${options.maxAge}`);
    
    if (options.noCache) {
      directives.push('no-cache');
    }
  }
  
  res.set('Cache-Control', directives.join(', '));
  
  if (options.vary.length > 0) {
    res.set('Vary', options.vary.join(', '));
  }
}

/**
 * Middleware for conditional GET with ETags and caching
 */
export function conditionalGet(options: CacheOptions = {}) {
  const opts = { ...DEFAULT_CACHE_OPTIONS, ...options };
  
  return (req: Request, res: Response, next: NextFunction) => {
    // Store original res.json and res.send methods
    const originalJson = res.json;
    const originalSend = res.send;
    
    let responseData: any;
    let statusCode: number = 200;
    
    // Override res.json to capture response data
    res.json = function(data: any) {
      responseData = data;
      statusCode = res.statusCode || 200;
      
      if (opts.etag && responseData !== undefined) {
        const etag = generateETag(responseData);
        res.set('ETag', etag);
        
        // Check for If-None-Match header
        const ifNoneMatch = req.get('If-None-Match');
        if (etagMatches(ifNoneMatch, etag)) {
          // Return 304 Not Modified
          res.status(304).end();
          return res;
        }
      }
      
      // Set cache headers
      setCacheHeaders(res, opts);
      
      // Call original json method
      return originalJson.call(res, data);
    } as any;
    
    // Override res.send to capture response data
    res.send = function(data: any) {
      responseData = data;
      statusCode = res.statusCode || 200;
      
      if (opts.etag && responseData !== undefined) {
        const etag = generateETag(responseData);
        res.set('ETag', etag);
        
        // Check for If-None-Match header
        const ifNoneMatch = req.get('If-None-Match');
        if (etagMatches(ifNoneMatch, etag)) {
          // Return 304 Not Modified
          res.status(304).end();
          return res;
        }
      }
      
      // Set cache headers
      setCacheHeaders(res, opts);
      
      // Call original send method
      return originalSend.call(res, data);
    } as any;
    
    next();
  };
}

/**
 * Middleware for no-cache endpoints (like auth)
 */
export function noCache() {
  return conditionalGet({
    noStore: true,
    etag: false,
  });
}

/**
 * Middleware for private cache (user-specific data)
 */
export function privateCache(maxAge: number = 300) {
  return conditionalGet({
    maxAge,
    private: true,
    vary: ['Authorization', 'Cookie'],
  });
}

/**
 * Middleware for public cache (shared data)
 */
export function publicCache(maxAge: number = 300) {
  return conditionalGet({
    maxAge,
    private: false,
  });
}

/**
 * Middleware for long-term cache (static-like data)
 */
export function longCache(maxAge: number = 86400) {
  return conditionalGet({
    maxAge,
    private: false,
  });
}

/**
 * Middleware for short-term cache (frequently changing data)
 */
export function shortCache(maxAge: number = 60) {
  return conditionalGet({
    maxAge,
    private: false,
  });
}

/**
 * Cache invalidation middleware for responses
 */
export function invalidateCache(patterns: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Store original res.json and res.send methods
    const originalJson = res.json;
    const originalSend = res.send;
    
    // Override methods to trigger cache invalidation after response
    const invalidateAfterResponse = () => {
      // Invalidate cache patterns after response is sent
      setTimeout(async () => {
        try {
          const { cacheDelPattern } = await import('../lib/cache');
          for (const pattern of patterns) {
            await cacheDelPattern(pattern);
          }
          console.log(`Invalidated cache patterns: ${patterns.join(', ')}`);
        } catch (error) {
          console.error('Cache invalidation failed:', error);
        }
      }, 0);
    };
    
    res.json = function(data: any) {
      invalidateAfterResponse();
      return originalJson.call(this, data);
    };
    
    res.send = function(data: any) {
      invalidateAfterResponse();
      return originalSend.call(this, data);
    };
    
    next();
  };
}

/**
 * Generate cache key for HTTP responses
 */
export function generateHttpCacheKey(req: Request): string {
  const parts = [
    req.method,
    req.originalUrl || req.url,
    req.get('Authorization')?.substring(0, 20) || 'anonymous', // First 20 chars of auth token
    req.get('Accept') || 'application/json',
  ];
  
  return parts.join(':');
}

/**
 * Check if request supports caching
 */
export function isCacheable(req: Request): boolean {
  // Only cache GET and HEAD requests
  if (!['GET', 'HEAD'].includes(req.method)) {
    return false;
  }
  
  // Don't cache if there are query parameters that indicate dynamic content
  const noCacheParams = ['_', 'nocache', 'refresh', 't'];
  const url = new URL(req.originalUrl || req.url, 'http://localhost');
  
  for (const param of noCacheParams) {
    if (url.searchParams.has(param)) {
      return false;
    }
  }
  
  return true;
}

export default {
  conditionalGet,
  noCache,
  privateCache,
  publicCache,
  longCache,
  shortCache,
  invalidateCache,
  generateETag,
  generateHttpCacheKey,
  isCacheable,
};
