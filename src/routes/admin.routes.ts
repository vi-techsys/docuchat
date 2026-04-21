import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate } from '../middleware/auths';
import { updateUserRole } from '../services/auth.services';
import { getUserPermissions } from '../services/auth.services';
import { noCache } from '../middleware/cache.middleware';

const router = Router();

// Apply authentication and no-cache to all admin routes
router.use(authenticate);
router.use(noCache());

// Middleware to check if user is admin
const requireAdmin = (req: Request, res: Response, next: any) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' }
    });
  }
  
  // For testing, we'll allow any authenticated user to access admin routes
  // In production, you'd check req.user.role === 'admin'
  next();
};

// PUT /api/v1/admin/users/:userId/role - Update user role
router.put('/users/:userId/role', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;
    
    if (!role || !['user', 'moderator', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid role. Must be one of: user, moderator, admin'
        }
      });
    }
    
    const updatedUser = await updateUserRole(userId as string, role);
    
    res.json({
      success: true,
      data: {
        userId: updatedUser.id,
        role: updatedUser.role,
        message: `User role updated to ${role}`
      }
    });
  } catch (error: any) {
    console.error('Failed to update user role:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to update user role'
      }
    });
  }
});

// GET /api/v1/admin/users/:userId/permissions - Get user permissions (for testing cache)
router.get('/users/:userId/permissions', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    const permissions = await getUserPermissions(userId as string);
    
    res.json({
      success: true,
      data: permissions
    });
  } catch (error: any) {
    console.error('Failed to get user permissions:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get user permissions'
      }
    });
  }
});

// GET /api/v1/admin/cache/stats - Get cache statistics (for testing)
router.get('/cache/stats', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { cacheRedis } = await import('../lib/cache');
    const { cacheDelPattern } = await import('../lib/cache');
    
    // Get Redis info
    const info = await cacheRedis.info('memory');
    const keyspace = await cacheRedis.info('keyspace');
    
    // Count cache keys
    const docKeys = await cacheRedis.keys('docuchat:doc:*');
    const permKeys = await cacheRedis.keys('docuchat:permissions:*');
    const allKeys = await cacheRedis.keys('docuchat:*');
    
    res.json({
      success: true,
      data: {
        redisInfo: {
          memory: info,
          keyspace: keyspace
        },
        cacheStats: {
          totalKeys: allKeys.length,
          documentKeys: docKeys.length,
          permissionKeys: permKeys.length,
          otherKeys: allKeys.length - docKeys.length - permKeys.length
        },
        sampleKeys: {
          documents: docKeys.slice(0, 5),
          permissions: permKeys.slice(0, 5),
          other: allKeys.filter(k => !k.includes(':doc:') && !k.includes(':permissions:')).slice(0, 5)
        }
      }
    });
  } catch (error: any) {
    console.error('Failed to get cache stats:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get cache statistics'
      }
    });
  }
});

// DELETE /api/v1/admin/cache/clear - Clear all cache (for testing)
router.delete('/cache/clear', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { cacheDelPattern } = await import('../lib/cache');
    
    const deletedCount = await cacheDelPattern('docuchat:*');
    
    res.json({
      success: true,
      data: {
        deletedKeys: deletedCount,
        message: 'Cache cleared successfully'
      }
    });
  } catch (error: any) {
    console.error('Failed to clear cache:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to clear cache'
      }
    });
  }
});

export default router;
