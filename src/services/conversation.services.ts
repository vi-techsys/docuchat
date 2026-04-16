import { prisma } from "../lib/prisma"

export async function createConversation(userId: string, documentId: string, title: string) {
  return prisma.conversation.create({
    data: {
      userId,
      documentId,
      title
    }
  })
}

export async function getConversations(userId: string, documentId?: string) {
  const where = documentId 
    ? { userId, documentId, deletedAt: null }
    : { userId, deletedAt: null }
  
  return prisma.conversation.findMany({ 
    where,
    include: {
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' }
      }
    }
  })
}

export async function getConversationById(conversationId: string, userId: string) {
  return prisma.conversation.findFirst({
    where: { id: conversationId, userId, deletedAt: null },
    include: {
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' }
      }
    }
  })
}

export async function updateConversation(conversationId: string, userId: string, data: any) {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { ...data }
  })
}

export async function softDeleteConversation(conversationId: string, userId: string) {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { deletedAt: new Date() }
  })
}
