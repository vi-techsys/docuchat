import { cacheDelPattern, simpleKey } from '../lib/cache';
import { invalidateUserPermissionsCache } from '../services/auth.services';
import { invalidateDocumentCache } from '../services/document.services';

export interface CacheInvalidationEvent {
  type: string;
  data: any;
  timestamp: Date;
}

/**
 * Handle cache invalidation events
 */
export async function handleCacheInvalidation(event: CacheInvalidationEvent) {
  console.log(`Processing cache invalidation event: ${event.type}`, event.data);
  
  try {
    switch (event.type) {
      case 'admin:role-assigned':
      case 'admin:role-revoked':
        await handlePermissionCacheInvalidation(event.data);
        break;
        
      case 'doc:deleted':
      case 'doc:updated':
        await handleDocumentCacheInvalidation(event.data);
        break;
        
      case 'user:updated':
        await handleUserCacheInvalidation(event.data);
        break;
        
      case 'conversation:updated':
      case 'conversation:deleted':
        await handleConversationCacheInvalidation(event.data);
        break;
        
      default:
        console.log(`No cache invalidation handler for event type: ${event.type}`);
    }
  } catch (error) {
    console.error(`Cache invalidation failed for event ${event.type}:`, error);
  }
}

/**
 * Invalidate permissions cache when roles are changed
 */
async function handlePermissionCacheInvalidation(data: { userId?: string; userIds?: string[] }) {
  const userIds = data.userIds || (data.userId ? [data.userId] : []);
  
  for (const userId of userIds) {
    await invalidateUserPermissionsCache(userId);
  }
  
  // Also invalidate any admin-level caches
  await cacheDelPattern('permissions:*');
  console.log(`Invalidated permissions cache for users: ${userIds.join(', ')}`);
}

/**
 * Invalidate document cache when documents are modified
 */
async function handleDocumentCacheInvalidation(data: { documentId?: string; documentIds?: string[]; userId?: string }) {
  const documentIds = data.documentIds || (data.documentId ? [data.documentId] : []);
  
  for (const documentId of documentIds) {
    // Invalidate both user-specific and public document caches
    await invalidateDocumentCache(documentId, data.userId);
    await invalidateDocumentCache(documentId); // Public version
    
    // Also invalidate any document list caches that might include this document
    await cacheDelPattern('doc:list:*');
  }
  
  console.log(`Invalidated document cache for documents: ${documentIds.join(', ')}`);
}

/**
 * Invalidate user-related caches when user data changes
 */
async function handleUserCacheInvalidation(data: { userId?: string; userIds?: string[] }) {
  const userIds = data.userIds || (data.userId ? [data.userId] : []);
  
  for (const userId of userIds) {
    // Invalidate permissions cache
    await invalidateUserPermissionsCache(userId);
    
    // Invalidate user session caches
    await cacheDelPattern(simpleKey('session', userId, '*'));
    
    // Invalidate user-specific document lists
    await cacheDelPattern(simpleKey('doc:list', userId, '*'));
  }
  
  console.log(`Invalidated user caches for users: ${userIds.join(', ')}`);
}

/**
 * Invalidate conversation caches when conversations are modified
 */
async function handleConversationCacheInvalidation(data: { conversationId?: string; conversationIds?: string[]; userId?: string }) {
  const conversationIds = data.conversationIds || (data.conversationId ? [data.conversationId] : []);
  
  for (const conversationId of conversationIds) {
    // Invalidate conversation metadata cache
    await cacheDelPattern(simpleKey('conversation', conversationId, '*'));
    
    // Invalidate conversation list caches
    if (data.userId) {
      await cacheDelPattern(simpleKey('conversation:list', data.userId, '*'));
    }
  }
  
  console.log(`Invalidated conversation caches for conversations: ${conversationIds.join(', ')}`);
}

/**
 * Emit cache invalidation events (for external systems)
 */
export function emitCacheInvalidation(type: string, data: any) {
  const event: CacheInvalidationEvent = {
    type,
    data,
    timestamp: new Date()
  };
  
  // In a real system, this might publish to a message queue
  // For now, we handle it directly
  handleCacheInvalidation(event);
}

/**
 * Convenience functions for common invalidation scenarios
 */
export const cacheInvalidators = {
  /**
   * Invalidate all caches for a user
   */
  invalidateUser: (userId: string) => {
    emitCacheInvalidation('user:updated', { userId });
  },
  
  /**
   * Invalidate user permissions
   */
  invalidatePermissions: (userId: string) => {
    emitCacheInvalidation('admin:role-revoked', { userId });
  },
  
  /**
   * Invalidate document cache
   */
  invalidateDocument: (documentId: string, userId?: string) => {
    emitCacheInvalidation('doc:updated', { documentId, userId });
  },
  
  /**
   * Invalidate conversation cache
   */
  invalidateConversation: (conversationId: string, userId?: string) => {
    emitCacheInvalidation('conversation:updated', { conversationId, userId });
  },
  
  /**
   * Bulk invalidate multiple users
   */
  invalidateUsers: (userIds: string[]) => {
    emitCacheInvalidation('user:updated', { userIds });
  },
  
  /**
   * Bulk invalidate multiple documents
   */
  invalidateDocuments: (documentIds: string[], userId?: string) => {
    emitCacheInvalidation('doc:updated', { documentIds, userId });
  },
};

/**
 * Cache warming utilities
 */
export const cacheWarmers = {
  /**
   * Warm permissions cache for a user
   */
  warmPermissions: async (userId: string) => {
    const { getUserPermissions } = await import('../services/auth.services');
    try {
      await getUserPermissions(userId);
      console.log(`Warmed permissions cache for user ${userId}`);
    } catch (error) {
      console.error(`Failed to warm permissions cache for user ${userId}:`, error);
    }
  },
  
  /**
   * Warm document cache
   */
  warmDocument: async (documentId: string, userId?: string) => {
    const { getDocument } = await import('../services/document.services');
    try {
      await getDocument(documentId, userId);
      console.log(`Warmed document cache for ${documentId}`);
    } catch (error) {
      console.error(`Failed to warm document cache for ${documentId}:`, error);
    }
  },
};

// Export for use in other modules
export default {
  handleCacheInvalidation,
  emitCacheInvalidation,
  cacheInvalidators,
  cacheWarmers,
};
