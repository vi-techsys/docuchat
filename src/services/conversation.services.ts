import { prisma } from "../lib/prisma"

export interface ListConversationsOptions {
  userId: string
  documentId?: string
  page?: number
  limit?: number
  sortBy?: 'createdAt' | 'updatedAt' | 'title'
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

export async function createConversation(userId: string, documentId: string, title: string) {
  return prisma.conversation.create({
    data: {
      userId,
      documentId,
      title
    }
  })
}

export async function listConversations(options: ListConversationsOptions): Promise<PaginatedResult<any>> {
  const {
    userId,
    documentId,
    page = 1,
    limit = 10,
    sortBy = 'updatedAt',
    sortOrder = 'desc'
  } = options

  const skip = (page - 1) * limit

  // Build where clause
  const where: any = { userId, deletedAt: null }
  
  if (documentId) {
    where.documentId = documentId
  }

  // Execute queries in parallel for better performance
  const [conversations, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      include: {
        document: {
          select: {
            id: true,
            title: true
          }
        },
        _count: {
          select: {
            messages: {
              where: { deletedAt: null }
            }
          }
        },
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            content: true,
            role: true,
            createdAt: true
          }
        }
      }
    }),
    prisma.conversation.count({ where })
  ])

  // Transform the data to include latest message preview and message count
  const transformedConversations = conversations.map(conv => ({
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    document: conv.document,
    messageCount: conv._count.messages,
    latestMessage: conv.messages[0] || null
  }))

  return {
    data: transformedConversations,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  }
}

export async function getConversation(conversationId: string, userId: string) {
  return prisma.conversation.findFirst({
    where: { id: conversationId, userId, deletedAt: null },
    include: {
      document: {
        select: {
          id: true,
          title: true,
          content: true
        }
      },
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          content: true,
          role: true,
          createdAt: true
        }
      }
    }
  })
}

export async function updateConversation(conversationId: string, userId: string, data: Partial<{ title: string }>) {
  return prisma.conversation.update({
    where: { id: conversationId, userId },
    data
  })
}

export async function deleteConversation(conversationId: string, userId: string) {
  return prisma.conversation.update({
    where: { id: conversationId, userId },
    data: { deletedAt: new Date() }
  })
}

export async function sendMessage(conversationId: string, userId: string, userMessage: string, assistantMessage: string) {
  return await prisma.$transaction(async (tx) => {
    // Verify conversation exists and belongs to user
    const conversation = await tx.conversation.findFirst({
      where: { id: conversationId, userId, deletedAt: null }
    })

    if (!conversation) {
      throw new Error('Conversation not found')
    }

    // Create user message
    const createdUserMessage = await tx.message.create({
      data: {
        conversationId,
        content: userMessage,
        role: 'user'
      }
    })

    // Create assistant message
    const createdAssistantMessage = await tx.message.create({
      data: {
        conversationId,
        content: assistantMessage,
        role: 'assistant'
      }
    })

    // Update conversation's updatedAt timestamp
    await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() }
    })

    // Log usage
    await tx.usageLog.create({
      data: {
        userId,
        action: 'message_sent',
        resourceId: conversationId,
        resourceType: 'conversation',
        metadata: {
          userMessageId: createdUserMessage.id,
          assistantMessageId: createdAssistantMessage.id,
          conversationTitle: conversation.title
        }
      }
    })

    return {
      userMessage: createdUserMessage,
      assistantMessage: createdAssistantMessage
    }
  })
}
