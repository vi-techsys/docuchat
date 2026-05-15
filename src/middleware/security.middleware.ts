import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import xss from 'xss';
import crypto from 'crypto';

// CSP configuration
const cspConfig = {
  directives: {
    defaultSrc: ["'none'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https:"],
    connectSrc: ["'self'"],
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    mediaSrc: ["'self'"],
    frameSrc: ["'none'"],
  },
};

// More relaxed CSP for API docs
const apiDocsCspConfig = {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    imgSrc: ["'self'", "data:", "https:"],
    connectSrc: ["'self'"],
    fontSrc: ["'self'", "https://fonts.gstatic.com"],
    objectSrc: ["'none'"],
    mediaSrc: ["'self'"],
    frameSrc: ["'none'"],
  },
};

// Helmet configuration
export const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: cspConfig.directives,
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  noSniff: true,
  frameguard: { action: 'deny' },
  xssFilter: true,
});

// Helmet for API docs (more relaxed)
export const helmetForDocs = helmet({
  contentSecurityPolicy: {
    directives: apiDocsCspConfig.directives,
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  noSniff: true,
  frameguard: { action: 'deny' },
  xssFilter: true,
});

// XSS filter options
const xssOptions = {
  whiteList: {
    a: ['href', 'title', 'target'],
    b: [],
    br: [],
    i: [],
    em: [],
    strong: [],
    p: [],
    ul: [],
    ol: [],
    li: [],
    h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
    blockquote: [],
    code: [],
    pre: [],
  },
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script'],
};

// Input sanitization middleware
export const sanitizeInput = (req: Request, res: Response, next: NextFunction) => {
  // Sanitize body
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  // Sanitize query parameters (store in custom property since req.query is read-only in Express 5)
  if (req.query) {
    (req as any).sanitizedQuery = sanitizeObject(req.query);
  }

  // Sanitize URL parameters (store in custom property since req.params is read-only in Express 5)
  if (req.params) {
    (req as any).sanitizedParams = sanitizeObject(req.params);
  }

  next();
};

// Recursive sanitization function
function sanitizeObject(obj: any): any {
  if (typeof obj === 'string') {
    return xss(obj, xssOptions);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  
  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
  }
  
  return obj;
}

// Prompt injection sanitizer (preview for Week 4)
export const sanitizePrompt = (prompt: string): string => {
  // Remove common prompt injection patterns
  const injectionPatterns = [
    /ignore\s+(previous|all)\s+instructions/gi,
    /system\s*:\s*/gi,
    /assistant\s*:\s*/gi,
    /\[BEGIN\s+INSTRUCTIONS\]/gi,
    /\[END\s+INSTRUCTIONS\]/gi,
    /act\s+as\s+a/gi,
    /pretend\s+to\s+be/gi,
    /roleplay\s+as/gi,
    /you\s+are\s+now/gi,
  ];
  
  let sanitized = prompt;
  
  for (const pattern of injectionPatterns) {
    sanitized = sanitized.replace(pattern, '[FILTERED]');
  }
  
  // Remove excessive whitespace
  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  
  return sanitized;
};

// Request fingerprinting middleware
export const attachFingerprint = (req: Request, res: Response, next: NextFunction) => {
  const fingerprint = generateRequestFingerprint(req);
  (req as any).fingerprint = fingerprint;
  
  // Add fingerprint to response headers for debugging
  res.set('X-Request-Fingerprint', fingerprint.substring(0, 16));
  
  next();
};

function generateRequestFingerprint(req: Request): string {
  const components = [
    req.ip,
    req.get('User-Agent') || '',
    req.get('Accept-Language') || '',
    req.get('Accept') || '',
    req.get('Accept-Encoding') || '',
  ];
  
  return crypto.createHash('sha256')
    .update(components.join('|'))
    .digest('hex');
}

// Suspicious activity tracking
const suspiciousActivityMap = new Map<string, {
  count: number;
  resetTime: number;
  documentIds: Set<string>;
  warnings: number;
}>();

export const trackSuspiciousActivity = (req: Request, res: Response, next: NextFunction) => {
  const fingerprint = (req as any).fingerprint || generateRequestFingerprint(req);
  const now = Date.now();
  const windowMs = 5 * 60 * 1000; // 5 minutes
  
  let activity = suspiciousActivityMap.get(fingerprint);
  
  if (!activity || now > activity.resetTime) {
    activity = {
      count: 0,
      resetTime: now + windowMs,
      documentIds: new Set(),
      warnings: 0,
    };
    suspiciousActivityMap.set(fingerprint, activity);
  }
  
  activity.count++;
  
  // Track document access for suspicious patterns
  if (req.params.documentId || req.params.id) {
    const documentId = req.params.documentId || req.params.id;
    activity.documentIds.add(documentId);
    
    // Warning if accessing 50+ unique documents in 5 minutes
    if (activity.documentIds.size >= 50 && activity.warnings === 0) {
      activity.warnings++;
      console.warn(`Suspicious activity: ${fingerprint} accessed ${activity.documentIds.size} unique documents in ${windowMs / 60000} minutes`);
      
      // Log security event
      logSecurityEvent('suspicious_document_access', {
        fingerprint,
        documentCount: activity.documentIds.size,
        timeWindow: windowMs,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      });
    }
  }
  
  // Cleanup old entries periodically
  if (suspiciousActivityMap.size > 10000) {
    for (const [key, value] of suspiciousActivityMap.entries()) {
      if (now > value.resetTime) {
        suspiciousActivityMap.delete(key);
      }
    }
  }
  
  next();
};

// Security event logging
function logSecurityEvent(eventType: string, data: any) {
  const securityEvent = {
    type: eventType,
    timestamp: new Date().toISOString(),
    data,
    severity: eventType.includes('failed_login') ? 'high' : 'medium',
  };
  
  console.warn('SECURITY EVENT:', JSON.stringify(securityEvent));
  
  // Store in Redis for analysis (optional)
  const { cacheRedis } = require('../lib/cache');
  cacheRedis.lpush('security_events', JSON.stringify(securityEvent))
    .then(() => cacheRedis.ltrim('security_events', 0, 999)) // Keep last 1000 events
    .catch(() => {}); // Ignore errors
}

// CORS configuration
export const corsConfig = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    const allowedOrigins = process.env.FRONTEND_URL 
      ? [process.env.FRONTEND_URL] 
      : ['http://localhost:3000', 'http://localhost:3001'];
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true, // For JWT auth
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID'],
  maxAge: 86400, // Cache preflight for 24 hours
};

export default {
  helmetMiddleware,
  helmetForDocs,
  sanitizeInput,
  sanitizePrompt,
  attachFingerprint,
  trackSuspiciousActivity,
  corsConfig,
};
