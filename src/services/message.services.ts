import { prisma } from "../lib/prisma"

export async function createMessage(conversationId: string, content: string, role: string) {
  return prisma.message.create({
    data: {
      conversationId,
      content,
      role
    }
  })
}

export async function getMessages(conversationId: string, userId: string) {
  // First verify the user has access to this conversation
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId, deletedAt: null }
  })
  
  if (!conversation) {
    throw new Error("Conversation not found or access denied")
  }
  
  return prisma.message.findMany({
    where: { conversationId, deletedAt: null },
    orderBy: { createdAt: 'asc' }
  })
}

export async function getMessageById(messageId: string, conversationId: string, userId: string) {
  // First verify the user has access to this conversation
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId, deletedAt: null }
  })
  
  if (!conversation) {
    throw new Error("Conversation not found or access denied")
  }
  
  return prisma.message.findFirst({
    where: { id: messageId, conversationId, deletedAt: null }
  })
}

export async function updateMessage(messageId: string, conversationId: string, userId: string, data: any) {
  // Verify access
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId, deletedAt: null }
  })
  
  if (!conversation) {
    throw new Error("Conversation not found or access denied")
  }
  
  return prisma.message.update({
    where: { id: messageId },
    data: { ...data }
  })
}

export async function softDeleteMessage(messageId: string, conversationId: string, userId: string) {
  // Verify access
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId, deletedAt: null }
  })
  
  if (!conversation) {
    throw new Error("Conversation not found or access denied")
  }
  
  return prisma.message.update({
    where: { id: messageId },
    data: { deletedAt: new Date() }
  })
}
