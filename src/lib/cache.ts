
import IORedis from 'ioredis';
import crypto from 'crypto';

// Cache TTL constants (in seconds)
export const CACHE_TTL = {
  PERMISSIONS: 5 * 60,        // 5 minutes
  DOCUMENT_METADATA: 15 * 60, // 15 minutes
  CONVERSATION_METADATA: 10 * 60, // 10 minutes
  USER_SESSION: 30 * 60,      // 30 minutes
  RATE_LIMIT: 60,             // 1 minute
  TEMPORARY: 5 * 60,          // 5 minutes
  LONG_TERM: 60 * 60,         // 1 hour
  EMBEDDING: 7 * 24 * 60 * 60, // 7 days - embeddings don't change for same input
} as const;

// Create separate Redis connection for caching

export const cacheRedis = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
  keyPrefix: 'docuchat:', // Global key prefix
});

// Cache connection events
cacheRedis.on('connect', () => {
  console.log('Cache Redis connected');
});

cacheRedis.on('error', (err) => {
  console.error('Cache Redis connection error:', err);
  console.log('Cache functionality will be limited without Redis');
});

cacheRedis.on('close', () => {
  console.log('Cache Redis connection closed');
});

/**
 * Generate deterministic cache keys using hash
 */
export function hashKey(...parts: (string | number)[]): string {
  const keyString = parts.join(':');
  return crypto.createHash('sha256').update(keyString).digest('hex').substring(0, 16);
}

/**
 * Simple key generation without hashing (for readable keys)
 */
export function simpleKey(...parts: (string | number)[]): string {
  return parts.join(':');
}

/**
 * Get value from cache
 */
export async function cacheGet(key: string): Promise<any> {
  try {
    const value = await cacheRedis.get(key);
    if (value === null) {
      return null;
    }
    
    console.log(`Cache HIT: ${key}`);
    return JSON.parse(value);
  } catch (error) {
    console.error(`Cache GET error for key ${key}:`, error);
    return null;
  }
}

/**
 * Set value in cache with TTL
 */
export async function cacheSet(key: string, value: any, ttlSeconds?: number): Promise<boolean> {
  try {
    const serialized = JSON.stringify(value);
    const ttl = ttlSeconds || CACHE_TTL.TEMPORARY;
    
    const result = await cacheRedis.setex(key, ttl, serialized);
    console.log(`Cache SET: ${key} (TTL: ${ttl}s)`);
    return result === 'OK';
  } catch (error) {
    console.error(`Cache SET error for key ${key}:`, error);
    return false;
  }
}

/**
 * Delete value from cache
 */
export async function cacheDel(key: string): Promise<boolean> {
  try {
    const result = await cacheRedis.del(key);
    console.log(`Cache DEL: ${key} (${result} keys deleted)`);
    return result > 0;
  } catch (error) {
    console.error(`Cache DEL error for key ${key}:`, error);
    return false;
  }
}

/**
 * Delete multiple keys matching pattern using SCAN (not KEYS)
 */
export async function cacheDelPattern(pattern: string): Promise<number> {
  try {
    let cursor = '0';
    let deletedCount = 0;
    
    do {
      try {
        // Use SCAN to iterate through keys
        const result = await cacheRedis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = result[0];
        const keys = result[1];
        
        if (keys.length > 0) {
          const deleted = await cacheRedis.del(...keys);
          deletedCount += deleted;
          console.log(`Cache DEL PATTERN: ${pattern} - deleted ${deleted} keys`);
        }
      } catch (scanError) {
        console.error(`Cache SCAN error for pattern ${pattern}:`, scanError);
        break;
      }
    } while (cursor !== '0');
    
    console.log(`Cache DEL PATTERN: ${pattern} - total deleted: ${deletedCount}`);
    return deletedCount;
  } catch (error) {
    console.error(`Cache DEL PATTERN error for pattern ${pattern}:`, error);
    return 0;
  }
}

/**
 * Check if key exists
 */
export async function cacheExists(key: string): Promise<boolean> {
  try {
    const result = await cacheRedis.exists(key);
    return result === 1;
  } catch (error) {
    console.error(`Cache EXISTS error for key ${key}:`, error);
    return false;
  }
}

/**
 * Get TTL for a key
 */
export async function cacheTTL(key: string): Promise<number> {
  try {
    const ttl = await cacheRedis.ttl(key);
    return ttl;
  } catch (error) {
    console.error(`Cache TTL error for key ${key}:`, error);
    return -1;
  }
}

/**
 * Cache-aside pattern with stampede prevention using locks
 */
export async function cacheGetOrSet<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds?: number,
  lockTimeout: number = 10
): Promise<T> {
  // Try to get from cache first
  const cached = await cacheGet(key);
  if (cached !== null) {
    return cached;
  }

  // Create a lock key for stampede prevention
  const lockKey = `${key}:lock`;
  const lockValue = crypto.randomUUID();
  
  try {
    // Try to acquire lock
    const lockAcquired = await cacheRedis.set(lockKey, lockValue, 'PX', lockTimeout * 1000, 'NX');
    
    if (lockAcquired === 'OK') {
      // We have the lock, fetch the data
      console.log(`Cache MISS: ${key} - fetching data with lock`);
      
      try {
        const data = await fetcher();
        
        // Cache the result
        await cacheSet(key, data, ttlSeconds);
        
        return data;
      } finally {
        // Release the lock
        await cacheRedis.del(lockKey);
      }
    } else {
      // Lock not acquired, wait a bit and try cache again
      console.log(`Cache MISS: ${key} - waiting for lock release`);
      
      // Wait a short time and check cache again
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const retryCached = await cacheGet(key);
      if (retryCached !== null) {
        return retryCached;
      }
      
      // If still not in cache, fetch without caching (to avoid infinite loops)
      console.log(`Cache MISS: ${key} - fetching without lock (fallback)`);
      return await fetcher();
    }
  } catch (error) {
    console.error(`Cache getOrSet error for key ${key}:`, error);
    
    // Fallback to direct fetch
    return await fetcher();
  }
}

/**
 * Increment a counter in cache
 */
export async function cacheIncrement(key: string, amount: number = 1): Promise<number> {
  try {
    const result = await cacheRedis.incrby(key, amount);
    console.log(`Cache INCR: ${key} by ${amount} = ${result}`);
    return result;
  } catch (error) {
    console.error(`Cache INCR error for key ${key}:`, error);
    return 0;
  }
}

/**
 * Get multiple keys at once
 */
export async function cacheMGet(keys: string[]): Promise<(any | null)[]> {
  try {
    const values = await cacheRedis.mget(...keys);
    return values.map(value => value === null ? null : JSON.parse(value));
  } catch (error) {
    console.error(`Cache MGET error for keys ${keys.join(', ')}:`, error);
    return keys.map(() => null);
  }
}

/**
 * Set multiple keys at once
 */
export async function cacheMSet(keyValues: Record<string, any>, ttlSeconds?: number): Promise<boolean> {
  try {
    const pipeline = cacheRedis.pipeline();
    
    for (const [key, value] of Object.entries(keyValues)) {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        pipeline.setex(key, ttlSeconds, serialized);
      } else {
        pipeline.set(key, serialized);
      }
    }
    
    const results = await pipeline.exec();
    const success = results?.every(([err]) => err === null) || false;
    
    if (success) {
      console.log(`Cache MSET: ${Object.keys(keyValues).length} keys`);
    }
    
    return success;
  } catch (error) {
    console.error(`Cache MSET error:`, error);
    return false;
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  try {
    await cacheRedis.quit();
  } catch (error) {
    // Ignore errors during shutdown
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  try {
    await cacheRedis.quit();
  } catch (error) {
    // Ignore errors during shutdown
  }
  process.exit(0);
});

export default {
  cacheRedis,
  cacheGet,
  cacheSet,
  cacheDel,
  cacheDelPattern,
  cacheGetOrSet,
  cacheExists,
  cacheTTL,
  cacheIncrement,
  cacheMGet,
  cacheMSet,
  hashKey,
  simpleKey,
  CACHE_TTL,
};
