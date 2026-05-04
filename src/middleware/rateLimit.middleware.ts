import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { Request } from 'express';
import { cacheRedis } from '../lib/cache';

// User tiers for rate limiting
export type UserTier = 'free' | 'pro' | 'enterprise';

// Rate limit configurations by tier
const TIER_LIMITS = {
  free: {
    api: { windowMs: 15 * 60 * 1000, max: 100 },    // 100 requests per 15 minutes
    upload: { windowMs: 60 * 60 * 1000, max: 5 },   // 5 uploads per hour
    chat: { windowMs: 60 * 1000, max: 10 },          // 10 chat messages per minute
  },
  pro: {
    api: { windowMs: 15 * 60 * 1000, max: 500 },     // 500 requests per 15 minutes
    upload: { windowMs: 60 * 60 * 1000, max: 50 },  // 50 uploads per hour
    chat: { windowMs: 60 * 1000, max: 30 },          // 30 chat messages per minute
  },
  enterprise: {
    api: { windowMs: 15 * 60 * 1000, max: 2000 },    // 2000 requests per 15 minutes
    upload: { windowMs: 60 * 60 * 1000, max: 500 },  // 500 uploads per hour
    chat: { windowMs: 60 * 1000, max: 100 },         // 100 chat messages per minute
  },
};

// Helper function to get user tier from request
function getUserTier(req: Request): UserTier {
  // Check if user is authenticated and get their role
  const user = (req as any).user;
  if (!user) return 'free';
  
  switch (user.role) {
    case 'enterprise':
      return 'enterprise';
    case 'pro':
      return 'pro';
    default:
      return 'free';
  }
}

// Generic rate limiter creator
function createLimiter(options: {
  windowMs: number;
  max: number;
  keyPrefix?: string;
  keyGenerator?: (req: Request) => string;
}) {
  return rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => cacheRedis.call(...args),
      prefix: `docuchat:rl:${options.keyPrefix || 'default'}`,
    }),
    windowMs: options.windowMs,
    max: options.max,
    message: {
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: Math.ceil(options.windowMs / 1000),
    },
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    keyGenerator: options.keyGenerator || ((req: Request) => {
      // Use user ID for authenticated requests, IP for anonymous
      const user = (req as any).user;
      return user ? `user:${user.id}` : `ip:${req.ip}`;
    }),
    handler: (req, res) => {
      const tier = getUserTier(req);
      console.log(`Rate limit exceeded for ${tier} tier: ${req.ip} ${req.method} ${req.path}`);
      res.status(429).json({
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.ceil(options.windowMs / 1000),
        tier,
      });
    },
  });
}

// Auth limiter - very strict, IP-based
export const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per 15 minutes
  keyPrefix: 'auth',
  keyGenerator: (req: Request) => `ip:${req.ip}`,
});

// Tier-based API limiters
export const createApiLimiter = (tier: UserTier) => {
  const limits = TIER_LIMITS[tier];
  return createLimiter({
    ...limits.api,
    keyPrefix: `api:${tier}`,
  });
};

// Upload limiters
export const createUploadLimiter = (tier: UserTier) => {
  const limits = TIER_LIMITS[tier];
  return createLimiter({
    ...limits.upload,
    keyPrefix: `upload:${tier}`,
  });
};

// Chat limiters
export const createChatLimiter = (tier: UserTier) => {
  const limits = TIER_LIMITS[tier];
  return createLimiter({
    ...limits.chat,
    keyPrefix: `chat:${tier}`,
  });
};

// Dynamic limiter that checks user tier and applies appropriate limits
export const tieredApiLimiter = (req: Request, res: any, next: any) => {
  const tier = getUserTier(req);
  const limiter = createApiLimiter(tier);
  return limiter(req, res, next);
};

export const tieredUploadLimiter = (req: Request, res: any, next: any) => {
  const tier = getUserTier(req);
  const limiter = createUploadLimiter(tier);
  return limiter(req, res, next);
};

export const tieredChatLimiter = (req: Request, res: any, next: any) => {
  const tier = getUserTier(req);
  const limiter = createChatLimiter(tier);
  return limiter(req, res, next);
};

// General API limiter (fallback)
export const apiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 1000, // Generous limit for general API
  keyPrefix: 'api',
});

// Abuse prevention - fingerprint-based limiter
export function createFingerprintLimiter() {
  const fingerprints = new Map<string, { count: number; resetTime: number }>();
  
  return (req: Request, res: any, next: any) => {
    const fingerprint = generateFingerprint(req);
    const now = Date.now();
    const windowMs = 5 * 60 * 1000; // 5 minutes
    const maxRequests = 50; // 50 unique documents per 5 minutes
    
    let data = fingerprints.get(fingerprint);
    
    if (!data || now > data.resetTime) {
      data = { count: 0, resetTime: now + windowMs };
      fingerprints.set(fingerprint, data);
    }
    
    data.count++;
    
    if (data.count > maxRequests) {
      console.log(`Suspicious activity detected: ${fingerprint} accessed ${data.count} resources`);
      return res.status(429).json({
        error: 'Suspicious activity detected',
        message: 'Too many unique resources accessed. Please slow down.',
      });
    }
    
    // Cleanup old entries
    if (fingerprints.size > 10000) {
      for (const [key, value] of fingerprints.entries()) {
        if (now > value.resetTime) {
          fingerprints.delete(key);
        }
      }
    }
    
    next();
  };
}

// Generate request fingerprint for abuse detection
function generateFingerprint(req: Request): string {
  const parts = [
    req.ip,
    req.get('User-Agent') || '',
    req.get('Accept-Language') || '',
    req.get('Accept') || '',
  ];
  return parts.join('|');
}

export default {
  authLimiter,
  tieredApiLimiter,
  tieredUploadLimiter,
  tieredChatLimiter,
  apiLimiter,
  createFingerprintLimiter,
  createApiLimiter,
  createUploadLimiter,
  createChatLimiter,
};
