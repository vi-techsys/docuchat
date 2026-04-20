import IORedis from 'ioredis';

// Create shared Redis connection with proper configuration for BullMQ
export const redisConnection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: false,
  lazyConnect: true, // Don't connect immediately
});

// Handle connection events
redisConnection.on('connect', () => {
  console.log('✅ Redis connected');
});

redisConnection.on('error', (err) => {
  console.error('❌ Redis connection error:', err);
  console.log('⚠️ Queue functionality will be limited without Redis');
});

redisConnection.on('close', () => {
  console.log('🔌 Redis connection closed');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  try {
    await redisConnection.quit();
  } catch (error) {
    // Ignore errors during shutdown
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  try {
    await redisConnection.quit();
  } catch (error) {
    // Ignore errors during shutdown
  }
  process.exit(0);
});

export default redisConnection;
