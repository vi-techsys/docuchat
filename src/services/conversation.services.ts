import { prisma } from "../lib/prisma"
import { semanticSearch } from './search.service';
import { assembleContext } from './context.service';
import { generateRAGResponse } from './rag-generation.service';
import { customLogger } from '../lib/logger';

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

export async function sendMessage(data: {
  conversationId: string;
  userId: string;
  content: string;
  documentId?: string;
  correlationId?: string;
}) {
  const startTime = Date.now();
  const { correlationId = 'unknown' } = data;

  try {
    return await prisma.$transaction(async (tx) => {
      // 1. Verify conversation ownership
      const conversation = await tx.conversation.findUnique({
        where: { id: data.conversationId },
      });
      
      if (!conversation || conversation.userId !== data.userId) {
        throw new Error('Conversation not found or access denied');
      }

      customLogger.info('Starting RAG pipeline for message', {
        correlationId,
        conversationId: data.conversationId,
        userId: data.userId,
        documentId: data.documentId,
        messageLength: data.content.length
      });

      // 2. Save user message
      const userMessage = await tx.message.create({
        data: {
          conversationId: data.conversationId,
          role: 'user',
          content: data.content,
          tokenCount: Math.ceil(data.content.length / 4), // Rough estimate
          model: null,
          temperature: null,
        },
      });

      // 3. Load recent conversation history
      const history = await tx.message.findMany({
        where: { conversationId: data.conversationId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { role: true, content: true },
      });
      const conversationHistory = history.reverse();

      customLogger.info('Conversation history loaded', {
        correlationId,
        historyLength: conversationHistory.length
      });

      // 4. RAG: Retrieve
      const searchResults = await semanticSearch({
        query: data.content,
        userId: data.userId,
        documentId: data.documentId,
        correlationId
      });

      customLogger.info('Semantic search completed', {
        correlationId,
        searchResults: searchResults.length,
        topScore: searchResults[0]?.score || 0
      });

      // 5. RAG: Augment
      const context = assembleContext(searchResults);

      customLogger.info('Context assembled', {
        correlationId,
        contextChunks: context.chunks.length,
        contextTokens: context.totalTokens
      });

      // 6. RAG: Generate
      const ragResponse = await generateRAGResponse({
        question: data.content,
        context,
        conversationHistory,
        userId: data.userId,
        conversationId: data.conversationId,
        correlationId,
      });

      customLogger.info('RAG response generated', {
        correlationId,
        answerLength: ragResponse.answer.length,
        tokensUsed: ragResponse.tokensUsed.total,
        costUsd: ragResponse.costUsd,
        processingTime: ragResponse.processingTime
      });

      // 7. Save assistant message with metadata
      const assistantMessage = await tx.message.create({
        data: {
          conversationId: data.conversationId,
          role: 'assistant',
          content: ragResponse.answer,
          tokenCount: ragResponse.tokensUsed.total,
          model: ragResponse.model,
          temperature: 0.1, // Default temperature for RAG
        },
      });

      // 8. Log usage
      await tx.usageLog.create({
        data: {
          userId: data.userId,
          action: 'rag_message_sent',
          resourceId: data.conversationId,
          resourceType: 'conversation',
          cost: ragResponse.costUsd,
          duration: Date.now() - startTime,
          metadata: JSON.stringify({
            userMessageId: userMessage.id,
            assistantMessageId: assistantMessage.id,
            conversationTitle: conversation.title,
            documentId: data.documentId,
            model: ragResponse.model,
            tokensUsed: ragResponse.tokensUsed,
            contextChunks: context.chunks.length,
            contextTokens: context.totalTokens,
            searchResults: searchResults.length,
            citations: ragResponse.citations.length,
            processingTime: ragResponse.processingTime,
            costUsd: ragResponse.costUsd
          })
        }
      });

      // 9. Touch conversation updatedAt
      await tx.conversation.update({
        where: { id: data.conversationId },
        data: { 
          updatedAt: new Date(),
          lastMessageAt: new Date()
        },
      });

      const totalProcessingTime = Date.now() - startTime;
      
      customLogger.info('RAG pipeline completed successfully', {
        correlationId,
        conversationId: data.conversationId,
        totalProcessingTime,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id
      });

      return {
        userMessage,
        assistantMessage: {
          ...assistantMessage,
          citations: ragResponse.citations,
          context: {
            chunks: context.chunks.length,
            tokens: context.totalTokens,
            searchResults: searchResults.length
          },
          usage: {
            tokens: ragResponse.tokensUsed,
            cost: ragResponse.costUsd,
            processingTime: ragResponse.processingTime
          }
        },
      };
    });

  } catch (error) {
    const totalProcessingTime = Date.now() - startTime;
    
    customLogger.error('RAG pipeline failed', {
      correlationId,
      conversationId: data.conversationId,
      error: error instanceof Error ? error.message : 'Unknown error',
      totalProcessingTime
    });

    // Log the failure
    await prisma.usageLog.create({
      data: {
        userId: data.userId,
        action: 'rag_message_failed',
        resourceId: data.conversationId,
        resourceType: 'conversation',
        duration: totalProcessingTime,
        metadata: JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
          correlationId,
          messageLength: data.content.length
        })
      }
    }).catch(logError => {
      // Ignore logging errors to prevent cascading failures
      console.error('Failed to log RAG failure:', logError);
    });

    throw error;
  }
}
