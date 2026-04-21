import { prisma } from "../lib/prisma"
import { cacheGetOrSet, simpleKey, CACHE_TTL } from "../lib/cache"

export interface ListDocumentsOptions {
  userId?: string
  page?: number
  limit?: number
  status?: string
  search?: string
  sortBy?: 'title' | 'createdAt' | 'status'
  sortOrder?: 'asc' | 'desc'
}

export interface PaginatedResult<T> {
  data: T[]
  meta: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export async function createDocument(userId: string, data: { title: string; content: string; status?: string }) {
  const document = await prisma.document.create({
    data: {
      userId,
      ...data
    }
  })

  // Log document creation event
  await prisma.usageLog.create({
    data: {
      userId,
      action: 'document_created',
      resourceId: document.id,
      resourceType: 'document',
      metadata: {
        title: document.title,
        status: document.status
      }
    }
  })

  return document
}

export async function listDocuments(options: ListDocumentsOptions = {}): Promise<PaginatedResult<any>> {
  const {
    userId,
    page = 1,
    limit = 10,
    status,
    search,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = options

  const skip = (page - 1) * limit

  // Build where clause
  const where: any = { deletedAt: null }
  
  if (userId) {
    where.userId = userId
  }
  
  if (status) {
    where.status = status
  }
  
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { content: { contains: search, mode: 'insensitive' } }
    ]
  }

  // Execute queries in parallel for better performance
  const [documents, total] = await Promise.all([
    prisma.document.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true
          }
        }
      }
    }),
    prisma.document.count({ where })
  ])

  return {
    data: documents,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  }
}

export async function getDocument(documentId: string, userId?: string) {
  const cacheKey = simpleKey('doc', documentId, userId || 'public');
  
  return cacheGetOrSet(
    cacheKey,
    async () => {
      console.log(`Fetching document ${documentId} from database`);
      
      const where = userId 
        ? { id: documentId, userId, deletedAt: null }
        : { id: documentId, deletedAt: null }
        
      const document = await prisma.document.findFirst({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true
            }
          }
        }
      });

      if (!document) {
        return null;
      }

      return document;
    },
    CACHE_TTL.DOCUMENT_METADATA // 15 minutes TTL
  );
}

export async function invalidateDocumentCache(documentId: string, userId?: string) {
  const cacheKey = simpleKey('doc', documentId, userId || 'public');
  const { cacheDel } = await import('../lib/cache');
  
  const deleted = await cacheDel(cacheKey);
  console.log(`Invalidated document cache for ${documentId}: ${deleted ? 'success' : 'failed'}`);
  
  return deleted;
}

export async function updateDocument(documentId: string, userId: string, data: Partial<{ title: string; content: string; status: string }>) {
  const document = await prisma.document.update({
    where: { id: documentId, userId },
    data
  });

  // Invalidate cache after successful update
  try {
    const { cacheInvalidators } = await import('../events/cache.events');
    await cacheInvalidators.invalidateDocument(documentId, userId);
  } catch (error) {
    console.error('Failed to invalidate document cache:', error);
  }

  return document;
}

export async function deleteDocument(documentId: string, userId: string) {
  const document = await prisma.document.update({
    where: { id: documentId, userId },
    data: { 
      deletedAt: new Date(),
      deletedBy: userId
    }
  })

  // Log document deletion event
  await prisma.usageLog.create({
    data: {
      userId,
      action: 'document_deleted',
      resourceId: document.id,
      resourceType: 'document',
      metadata: {
        title: document.title,
        status: document.status
      }
    }
  })

  // Invalidate cache after successful deletion
  try {
    const { cacheInvalidators } = await import('../events/cache.events');
    await cacheInvalidators.invalidateDocument(documentId, userId);
  } catch (error) {
    console.error('Failed to invalidate document cache:', error);
  }

  return document
}