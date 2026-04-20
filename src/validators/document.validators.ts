import { z } from 'zod'

export const createDocumentSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255, 'Title must be less than 255 characters'),
  content: z.string().min(1, 'Content is required'),
  status: z.enum(['pending', 'processing', 'ready', 'error']).optional().default('pending')
})

export const updateDocumentSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255, 'Title must be less than 255 characters').optional(),
  content: z.string().min(1, 'Content is required').optional(),
  status: z.enum(['pending', 'processing', 'ready', 'error']).optional()
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update'
})

export const listDocumentsSchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(10),
  status: z.enum(['pending', 'processing', 'ready', 'error']).optional(),
  search: z.string().min(1).max(255).optional(),
  sortBy: z.enum(['title', 'createdAt', 'status']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
})

export const documentIdSchema = z.object({
  id: z.string().uuid('Invalid document ID format')
})

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>
export type ListDocumentsInput = z.infer<typeof listDocumentsSchema>
export type DocumentIdInput = z.infer<typeof documentIdSchema>
