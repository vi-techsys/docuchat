import bcrypt from "bcryptjs"
import { prisma } from "../lib/prisma"
import { generateAccessToken, generateRefreshToken } from "../lib/tokens"
import { cacheGetOrSet, simpleKey, CACHE_TTL } from "../lib/cache"
import { trackFailedLoginAttempt, clearFailedLoginAttempts } from "../events/security.events"
import { recordAuthEvent, recordCacheOperation } from "../lib/metrics"
import { logAuthEvent, logCacheOperation, logPerformance } from "../lib/structuredLogger"

export async function register(email: string, password: string) {

 const hash = await bcrypt.hash(password, 12)

 return prisma.user.create({
  data: { email, passwordHash: hash }
 })
}

export async function login(email: string, password: string, ip?: string, userAgent?: string) {
  const startTime = Date.now();
  
  try {
    const user = await prisma.user.findFirst({
      where: { email, deletedAt: null }
    });

    if (!user) {
      // Track failed login attempt
      if (ip) {
        await trackFailedLoginAttempt(ip, userAgent, undefined, email);
        recordAuthEvent('login', 'failure', ip);
        logAuthEvent('login', 'failure', { ip, userAgent, email });
      }
      throw Error("Invalid credentials");
    }

    const valid = await bcrypt.compare(password, user.passwordHash);

    if (!valid) {
      // Track failed login attempt
      if (ip) {
        await trackFailedLoginAttempt(ip, userAgent, user.id, email);
        recordAuthEvent('login', 'failure', ip);
        logAuthEvent('login', 'failure', { ip, userAgent, userId: user.id, email });
      }
      throw Error("Invalid credentials");
    }

    // Clear failed login attempts on successful login
    if (ip) {
      await clearFailedLoginAttempts(ip);
    }

    const refreshToken = generateRefreshToken(user.id);
    
    // Store refresh token in database
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      }
    });

    // Record successful login
    if (ip) {
      recordAuthEvent('login', 'success', ip);
      logAuthEvent('login', 'success', { ip, userAgent, userId: user.id, email });
    }

    const duration = Date.now() - startTime;
    logPerformance('login', duration, { userId: user.id, email });

    return {
      accessToken: generateAccessToken(user.id),
      refreshToken
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    logPerformance('login', duration, { email, error: error instanceof Error ? error.message : 'Unknown error' });
    throw error;
  }
}

export async function logout(userId: string, accessToken: string) {
  // Soft delete all refresh tokens for this user
  await prisma.refreshToken.updateMany({
    where: { userId, deletedAt: null },
    data: { deletedAt: new Date() }
  })
  
  // Blacklist the access token to invalidate it immediately
  await prisma.blacklistedToken.create({
    data: {
      token: accessToken,
      userId,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes from now
    }
  })
  
  return { success: true }
}

export async function softDeleteUser(userId: string) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { deletedAt: new Date() }
  });

  // Invalidate all user caches on deletion
  try {
    const { cacheInvalidators } = await import('../events/cache.events');
    await cacheInvalidators.invalidateUser(userId);
  } catch (error) {
    console.error('Failed to invalidate user cache on deletion:', error);
  }

  return user;
}

export async function updateUserRole(userId: string, role: string) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { role }
  });

  // Invalidate permissions cache on role change
  try {
    const { cacheInvalidators } = await import('../events/cache.events');
    await cacheInvalidators.invalidatePermissions(userId);
  } catch (error) {
    console.error('Failed to invalidate permissions cache on role change:', error);
  }

  return user;
}

export async function getUserById(userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, deletedAt: null }
  })
}

export async function getUserPermissions(userId: string) {
  const cacheKey = simpleKey('permissions', userId);
  
  return cacheGetOrSet(
    cacheKey,
    async () => {
      console.log(`Fetching permissions for user ${userId} from database`);
      
      const user = await prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: {
          id: true,
          email: true,
          role: true,
          createdAt: true
        }
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Define permissions based on role
      const permissions = {
        // Basic permissions for all users
        read: true,
        write: true,
        
        // Role-specific permissions
        admin: user.role === 'admin',
        moderator: user.role === 'admin' || user.role === 'moderator',
        
        // Resource-specific permissions
        canDeleteDocuments: user.role === 'admin',
        canManageUsers: user.role === 'admin',
        canViewAnalytics: user.role === 'admin' || user.role === 'moderator',
        
        // User metadata
        userId: user.id,
        userRole: user.role,
        userCreatedAt: user.createdAt
      };

      return permissions;
    },
    CACHE_TTL.PERMISSIONS // 5 minutes TTL
  );
}

export async function invalidateUserPermissionsCache(userId: string) {
  const cacheKey = simpleKey('permissions', userId);
  const { cacheDel } = await import('../lib/cache');
  
  const deleted = await cacheDel(cacheKey);
  console.log(`Invalidated permissions cache for user ${userId}: ${deleted ? 'success' : 'failed'}`);
  
  return deleted;
}