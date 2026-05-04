import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { cacheRedis } from '../lib/cache';
import { logger } from '../lib/structuredLogger';

const router = Router();

// Basic liveness probe - just check if the process is running
router.get('/live', (req: Request, res: Response) => {
  const uptime = process.uptime();
  const memoryUsage = process.memoryUsage();
  
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
    memory: {
      rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
      heap: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
      external: `${Math.round(memoryUsage.external / 1024 / 1024)}MB`,
    },
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  };
  
  logger.debug('Liveness check passed', { health });
  res.status(200).json(health);
});

// Readiness probe - check dependencies (database, Redis)
router.get('/ready', async (req: Request, res: Response) => {
  const checks = {
    database: { status: 'unknown', responseTime: 0, error: null as string | null },
    redis: { status: 'unknown', responseTime: 0, error: null as string | null },
  };
  
  let overallStatus = 'healthy';
  
  try {
    // Check database connection
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    checks.database.responseTime = Date.now() - dbStart;
    checks.database.status = 'healthy';
  } catch (error) {
    checks.database.status = 'unhealthy';
    checks.database.error = error instanceof Error ? error.message : 'Unknown database error';
    overallStatus = 'unhealthy';
    logger.error('Database health check failed', { error: checks.database.error });
  }
  
  try {
    // Check Redis connection
    const redisStart = Date.now();
    await cacheRedis.ping();
    checks.redis.responseTime = Date.now() - redisStart;
    checks.redis.status = 'healthy';
  } catch (error) {
    checks.redis.status = 'unhealthy';
    checks.redis.error = error instanceof Error ? error.message : 'Unknown Redis error';
    overallStatus = 'unhealthy';
    logger.error('Redis health check failed', { error: checks.redis.error });
  }
  
  const health = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks,
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
  };
  
  const statusCode = overallStatus === 'healthy' ? 200 : 503;
  
  if (overallStatus === 'healthy') {
    logger.debug('Readiness check passed', { health });
  } else {
    logger.warn('Readiness check failed', { health });
  }
  
  res.status(statusCode).json(health);
});

// Detailed health check with more information
router.get('/detailed', async (req: Request, res: Response) => {
  const checks = {
    database: { status: 'unknown', responseTime: 0, error: null as string | null, details: {} as any },
    redis: { status: 'unknown', responseTime: 0, error: null as string | null, details: {} as any },
    queues: { status: 'unknown', error: null as string | null, details: {} as any },
    memory: { status: 'unknown', details: {} as any },
  };
  
  let overallStatus = 'healthy';
  
  // Database detailed check
  try {
    const dbStart = Date.now();
    
    // Basic connectivity
    await prisma.$queryRaw`SELECT 1`;
    const basicTime = Date.now() - dbStart;
    
    // Check table counts
    const [userCount, documentCount, conversationCount] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.document.count({ where: { deletedAt: null } }),
      prisma.conversation.count({ where: { deletedAt: null } }),
    ]);
    
    checks.database = {
      status: 'healthy',
      responseTime: basicTime,
      error: null,
      details: {
        userCount,
        documentCount,
        conversationCount,
        connectionPool: {
          // Note: These would need to be configured in Prisma to get actual values
          total: 'unknown',
          active: 'unknown',
          idle: 'unknown',
        },
      },
    };
  } catch (error) {
    checks.database.status = 'unhealthy';
    checks.database.error = error instanceof Error ? error.message : 'Unknown database error';
    overallStatus = 'unhealthy';
  }
  
  // Redis detailed check
  try {
    const redisStart = Date.now();
    
    // Basic connectivity
    await cacheRedis.ping();
    const basicTime = Date.now() - redisStart;
    
    // Get Redis info
    const info = await cacheRedis.info();
    const infoLines = info.split('\r\n');
    const getInfo = (key: string) => {
      const line = infoLines.find(line => line.startsWith(`${key}:`));
      return line ? line.split(':')[1] : 'unknown';
    };
    
    // Get cache keys count
    const cacheKeys = await cacheRedis.dbSize();
    
    checks.redis = {
      status: 'healthy',
      responseTime: basicTime,
      error: null,
      details: {
        version: getInfo('redis_version'),
        uptime: getInfo('uptime_in_seconds'),
        connectedClients: getInfo('connected_clients'),
        usedMemory: getInfo('used_memory_human'),
        cacheKeys,
        cacheHitRate: 'unknown', // Would need to track this separately
      },
    };
  } catch (error) {
    checks.redis.status = 'unhealthy';
    checks.redis.error = error instanceof Error ? error.message : 'Unknown Redis error';
    overallStatus = 'unhealthy';
  }
  
  // Queue health check (if BullMQ is available)
  try {
    const { documentQueue } = await import('../queues/document.queue');
    
    const waiting = await documentQueue.getWaiting();
    const active = await documentQueue.getActive();
    const completed = await documentQueue.getCompleted();
    const failed = await documentQueue.getFailed();
    
    checks.queues = {
      status: 'healthy',
      error: null,
      details: {
        documentQueue: {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
        },
      },
    };
  } catch (error) {
    checks.queues.status = 'unknown';
    checks.queues.error = error instanceof Error ? error.message : 'Queue system not available';
    logger.warn('Queue health check failed', { error: checks.queues.error });
  }
  
  // Memory check
  const memoryUsage = process.memoryUsage();
  const totalMemory = memoryUsage.rss;
  const heapUsed = memoryUsage.heapUsed;
  const heapTotal = memoryUsage.heapTotal;
  
  // Consider memory unhealthy if using more than 90% of available heap
  const heapUsagePercent = (heapUsed / heapTotal) * 100;
  const memoryStatus = heapUsagePercent > 90 ? 'unhealthy' : heapUsagePercent > 75 ? 'warning' : 'healthy';
  
  if (memoryStatus === 'unhealthy') {
    overallStatus = 'unhealthy';
  }
  
  checks.memory = {
    status: memoryStatus,
    details: {
      rss: `${Math.round(totalMemory / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(heapTotal / 1024 / 1024)}MB`,
      heapUsagePercent: `${Math.round(heapUsagePercent)}%`,
      external: `${Math.round(memoryUsage.external / 1024 / 1024)}MB`,
    },
  };
  
  const health = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    checks,
  };
  
  const statusCode = overallStatus === 'healthy' ? 200 : 503;
  
  logger.debug('Detailed health check', { status: overallStatus, checks });
  
  res.status(statusCode).json(health);
});

// Simple health check for load balancers (minimal response)
router.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

export default router;
