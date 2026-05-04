import winston from 'winston';
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// Log levels
export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  HTTP = 'http',
  DEBUG = 'debug',
}

// Custom log format
const customFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, correlationId, userId, ...meta }) => {
    const logEntry = {
      timestamp,
      level,
      message: String(message),
      correlationId: String(correlationId || ''),
      userId: String(userId || ''),
      ...meta,
    };
    return JSON.stringify(logEntry);
  })
);

// Development format (colorized and readable)
const developmentFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, correlationId, userId, ...meta }) => {
    const parts = [
      `[${timestamp}]`,
      String(level),
    ];
    
    if (correlationId) parts.push(`[${String(correlationId)}]`);
    if (userId) parts.push(`[User:${String(userId)}]`);
    
    parts.push(String(message));
    
    // Add metadata if present
    const metaString = Object.keys(meta).length > 0 ? JSON.stringify(meta) : '';
    return `${parts.join(' ')} ${metaString}`;
  })
);

// Create logger instance
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: process.env.NODE_ENV === 'production' ? customFormat : developmentFormat,
  defaultMeta: {
    service: 'docuchat-api',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production' ? customFormat : developmentFormat,
    }),
  ],
  // Handle exceptions and rejections
  exceptionHandlers: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
    }),
  ],
  rejectionHandlers: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
    }),
  ],
});

// Add file transports in production
if (process.env.NODE_ENV === 'production') {
  logger.add(new winston.transports.File({
    filename: 'logs/error.log',
    level: 'error',
    format: customFormat,
    maxsize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
  }));
  
  logger.add(new winston.transports.File({
    filename: 'logs/combined.log',
    format: customFormat,
    maxsize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
  }));
}

// Correlation ID middleware
export const correlationIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Get existing correlation ID from header or generate new one
  const correlationId = req.get('X-Correlation-ID') || crypto.randomUUID();
  
  // Add to request object
  (req as any).correlationId = correlationId;
  
  // Add to response headers
  res.set('X-Correlation-ID', correlationId);
  
  // Add user ID if authenticated
  const user = (req as any).user;
  const userId = user ? user.id : undefined;
  
  // Create child logger with correlation context
  const childLogger = logger.child({
    correlationId,
    userId,
    method: req.method,
    url: req.originalUrl || req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });
  
  // Add child logger to request
  (req as any).logger = childLogger;
  
  next();
};

// Request/response logging middleware
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const childLogger = (req as any).logger || logger;
  
  // Log request
  childLogger.http('Request started', {
    method: req.method,
    url: req.originalUrl || req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    contentLength: req.get('Content-Length'),
  });
  
  // Listen for finish event to log response
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    
    childLogger.http('Request completed', {
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      contentLength: res.get('Content-Length'),
      ip: req.ip,
    });
  });
  
  next();
};

// Helper functions for structured logging
export const logInfo = (message: string, meta?: any, correlationId?: string) => {
  logger.info(message, { ...meta, correlationId });
};

export const logError = (message: string, error?: Error | any, meta?: any, correlationId?: string) => {
  const errorMeta = {
    ...meta,
    correlationId,
    ...(error && {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    }),
  };
  
  logger.error(message, errorMeta);
};

export const logWarn = (message: string, meta?: any, correlationId?: string) => {
  logger.warn(message, { ...meta, correlationId });
};

export const logDebug = (message: string, meta?: any, correlationId?: string) => {
  logger.debug(message, { ...meta, correlationId });
};

export const logHttp = (message: string, meta?: any, correlationId?: string) => {
  logger.http(message, { ...meta, correlationId });
};

// Business event logging
export const logBusinessEvent = (
  eventType: string,
  userId?: string,
  data?: any,
  correlationId?: string
) => {
  logger.info(`Business event: ${eventType}`, {
    eventType,
    userId,
    data,
    correlationId,
    timestamp: new Date().toISOString(),
  });
};

// Performance logging
export const logPerformance = (
  operation: string,
  duration: number,
  meta?: any,
  correlationId?: string
) => {
  const level = duration > 1000 ? 'warn' : duration > 500 ? 'info' : 'debug';
  
  logger.log(level, `Performance: ${operation}`, {
    operation,
    duration: `${duration}ms`,
    ...meta,
    correlationId,
  });
};

// Security event logging (integrates with security.events.ts)
export const logSecurityEvent = (
  eventType: string,
  data: any,
  severity: 'low' | 'medium' | 'high' | 'critical' = 'medium',
  correlationId?: string
) => {
  const level = severity === 'critical' ? 'error' : severity === 'high' ? 'warn' : 'info';
  
  logger.log(level, `Security event: ${eventType}`, {
    eventType,
    severity,
    data,
    correlationId,
    timestamp: new Date().toISOString(),
  });
};

// Database query logging
export const logQuery = (
  query: string,
  duration: number,
  params?: any,
  correlationId?: string
) => {
  const level = duration > 1000 ? 'warn' : 'debug';
  
  logger.log(level, `Database query`, {
    query: query.substring(0, 200) + (query.length > 200 ? '...' : ''),
    duration: `${duration}ms`,
    params: params ? JSON.stringify(params).substring(0, 100) : undefined,
    correlationId,
  });
};

// Cache operation logging
export const logCacheOperation = (
  operation: 'hit' | 'miss' | 'set' | 'del',
  key: string,
  meta?: any,
  correlationId?: string
) => {
  logger.debug(`Cache ${operation}`, {
    operation,
    key,
    ...meta,
    correlationId,
  });
};

// Queue operation logging
export const logQueueOperation = (
  queueName: string,
  operation: 'add' | 'process' | 'complete' | 'fail',
  jobId?: string,
  meta?: any,
  correlationId?: string
) => {
  logger.info(`Queue ${operation}`, {
    queueName,
    operation,
    jobId,
    ...meta,
    correlationId,
  });
};

// Authentication event logging
export const logAuthEvent = (
  eventType: 'login' | 'logout' | 'register' | 'token_refresh',
  result: 'success' | 'failure',
  data?: any,
  correlationId?: string
) => {
  logger.info(`Auth event: ${eventType} - ${result}`, {
    eventType,
    result,
    ...data,
    correlationId,
    timestamp: new Date().toISOString(),
  });
};

// Export logger for direct use
export default logger;
