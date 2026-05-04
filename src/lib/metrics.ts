import client from 'prom-client';
import { Request, Response, NextFunction } from 'express';

// Create a Registry to register the metrics
const register = new client.Registry();

// Add default metrics (event loop lag, memory usage, CPU usage, etc.)
client.collectDefaultMetrics({ register });

// Custom metrics

// HTTP request counter
export const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code', 'user_tier'],
  registers: [register],
});

// HTTP request duration histogram
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code', 'user_tier'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 5, 7, 10],
  registers: [register],
});

// Business metrics

// Documents processed counter
export const documentsProcessedCounter = new client.Counter({
  name: 'documents_processed_total',
  help: 'Total number of documents processed',
  labelNames: ['operation', 'status', 'user_tier'],
  registers: [register],
});

// Active queue jobs gauge
export const activeQueueJobsGauge = new client.Gauge({
  name: 'active_queue_jobs',
  help: 'Number of active queue jobs',
  labelNames: ['queue_name'],
  registers: [register],
});

// Cache hit/miss counter
export const cacheOperationCounter = new client.Counter({
  name: 'cache_operations_total',
  help: 'Total number of cache operations',
  labelNames: ['operation', 'result', 'cache_type'],
  registers: [register],
});

// Database query counter
export const databaseQueryCounter = new client.Counter({
  name: 'database_queries_total',
  help: 'Total number of database queries',
  labelNames: ['operation', 'table', 'status'],
  registers: [register],
});

// Database query duration histogram
export const databaseQueryDuration = new client.Histogram({
  name: 'database_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// Authentication events counter
export const authEventsCounter = new client.Counter({
  name: 'auth_events_total',
  help: 'Total number of authentication events',
  labelNames: ['event_type', 'result', 'ip'],
  registers: [register],
});

// Security events counter
export const securityEventsCounter = new client.Counter({
  name: 'security_events_total',
  help: 'Total number of security events',
  labelNames: ['event_type', 'severity', 'ip'],
  registers: [register],
});

// Rate limit events counter
export const rateLimitCounter = new client.Counter({
  name: 'rate_limit_events_total',
  help: 'Total number of rate limit events',
  labelNames: ['limiter_type', 'result', 'user_tier', 'ip'],
  registers: [register],
});

// User sessions gauge
export const userSessionsGauge = new client.Gauge({
  name: 'user_sessions_active',
  help: 'Number of active user sessions',
  labelNames: ['user_tier'],
  registers: [register],
});

// API errors counter
export const apiErrorsCounter = new client.Counter({
  name: 'api_errors_total',
  help: 'Total number of API errors',
  labelNames: ['error_type', 'route', 'method', 'status_code'],
  registers: [register],
});

// Path normalization function to prevent cardinality explosion
function normalizePath(path: string): string {
  // Replace UUIDs and other IDs with placeholders
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/gi, '/:id')
    .replace(/\/[a-zA-Z0-9_-]{20,}/gi, '/:token');
}

// Get user tier from request
function getUserTier(req: Request): string {
  const user = (req as any).user;
  if (!user) return 'anonymous';
  
  switch (user.role) {
    case 'enterprise':
      return 'enterprise';
    case 'pro':
      return 'pro';
    default:
      return 'free';
  }
}

// Metrics middleware
export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const method = req.method;
  const route = normalizePath(req.originalUrl || req.url);
  const userTier = getUserTier(req);
  
  // Listen for finish event to collect metrics
  res.on('finish', () => {
    const duration = (Date.now() - startTime) / 1000; // Convert to seconds
    const statusCode = res.statusCode;
    
    // Record HTTP request metrics
    httpRequestCounter.inc({
      method,
      route,
      status_code: statusCode.toString(),
      user_tier: userTier,
    });
    
    httpRequestDuration.observe({
      method,
      route,
      status_code: statusCode.toString(),
      user_tier: userTier,
    }, duration);
    
    // Record error metrics for 4xx and 5xx responses
    if (statusCode >= 400) {
      apiErrorsCounter.inc({
        error_type: statusCode >= 500 ? 'server_error' : 'client_error',
        route,
        method,
        status_code: statusCode.toString(),
      });
    }
  });
  
  next();
};

// Helper functions to record metrics

export const recordDocumentProcessed = (
  operation: string,
  status: string,
  userTier: string = 'free'
) => {
  documentsProcessedCounter.inc({
    operation,
    status,
    user_tier: userTier,
  });
};

export const recordCacheOperation = (
  operation: 'hit' | 'miss' | 'set' | 'del',
  result: 'success' | 'error',
  cacheType: string = 'redis'
) => {
  cacheOperationCounter.inc({
    operation,
    result,
    cache_type: cacheType,
  });
};

export const recordDatabaseQuery = (
  operation: string,
  table: string,
  status: 'success' | 'error',
  duration: number
) => {
  databaseQueryCounter.inc({
    operation,
    table,
    status,
  });
  
  databaseQueryDuration.observe({
    operation,
    table,
  }, duration / 1000); // Convert ms to seconds
};

export const recordAuthEvent = (
  eventType: 'login' | 'logout' | 'register' | 'token_refresh',
  result: 'success' | 'failure',
  ip: string
) => {
  authEventsCounter.inc({
    event_type: eventType,
    result,
    ip,
  });
};

export const recordSecurityEvent = (
  eventType: string,
  severity: string,
  ip: string
) => {
  securityEventsCounter.inc({
    event_type: eventType,
    severity,
    ip,
  });
};

export const recordRateLimitEvent = (
  limiterType: string,
  result: 'allowed' | 'blocked',
  userTier: string,
  ip: string
) => {
  rateLimitCounter.inc({
    limiter_type: limiterType,
    result,
    user_tier: userTier,
    ip,
  });
};

export const setActiveQueueJobs = (queueName: string, count: number) => {
  activeQueueJobsGauge.set({ queue_name: queueName }, count);
};

export const setActiveUserSessions = (userTier: string, count: number) => {
  userSessionsGauge.set({ user_tier: userTier }, count);
};

// Metrics endpoint handler
export const metricsHandler = async (req: Request, res: Response) => {
  try {
    const metrics = await register.metrics();
    res.set('Content-Type', register.contentType);
    res.end(metrics);
  } catch (error) {
    console.error('Failed to generate metrics:', error);
    res.status(500).end('Error generating metrics');
  }
};

// Get metrics as JSON (for debugging)
export const getMetricsAsJson = async () => {
  const metrics = await register.getMetricsAsJSON();
  return metrics;
};

// Reset all metrics (useful for testing)
export const resetMetrics = () => {
  register.clear();
  client.collectDefaultMetrics({ register });
};

// Export register for external use
export { register };

export default {
  register,
  metricsMiddleware,
  metricsHandler,
  getMetricsAsJson,
  resetMetrics,
  // Metric objects
  httpRequestCounter,
  httpRequestDuration,
  documentsProcessedCounter,
  activeQueueJobsGauge,
  cacheOperationCounter,
  databaseQueryCounter,
  databaseQueryDuration,
  authEventsCounter,
  securityEventsCounter,
  rateLimitCounter,
  userSessionsGauge,
  apiErrorsCounter,
  // Helper functions
  recordDocumentProcessed,
  recordCacheOperation,
  recordDatabaseQuery,
  recordAuthEvent,
  recordSecurityEvent,
  recordRateLimitEvent,
  setActiveQueueJobs,
  setActiveUserSessions,
};
