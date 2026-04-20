import { z } from 'zod'

export const createConversationSchema = z.object({
  documentId: z.string().uuid('Invalid document ID format'),
  title: z.string().min(1, 'Title is required').max(255, 'Title must be less than 255 characters')
})

export const updateConversationSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255, 'Title must be less than 255 characters')
})

export const listConversationsSchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(10),
  documentId: z.string().uuid('Invalid document ID format').optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'title']).optional().default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
})

export const sendMessageSchema = z.object({
  message: z.string().min(1, 'Message is required').max(10000, 'Message must be less than 10000 characters')
})

export const conversationIdSchema = z.object({
  id: z.string().uuid('Invalid conversation ID format')
})

export type CreateConversationInput = z.infer<typeof createConversationSchema>
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>
export type ListConversationsInput = z.infer<typeof listConversationsSchema>
export type SendMessageInput = z.infer<typeof sendMessageSchema>
export type ConversationIdInput = z.infer<typeof conversationIdSchema>
