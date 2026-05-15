/// <reference path="../types/express.d.ts">
import { Router } from "express"
import type { Request, Response } from "express"
import { authenticate } from "../middleware/auths"
import { tieredApiLimiter } from "../middleware/rateLimit.middleware"
import { prisma } from "../lib/prisma"
import { 
  createConversation, 
  listConversations, 
  getConversation, 
  updateConversation, 
  deleteConversation,
  sendMessage 
} from "../services/conversation.services"
import { 
  createConversationSchema, 
  updateConversationSchema, 
  listConversationsSchema, 
  sendMessageSchema,
  conversationIdSchema 
} from "../validators/conversation.validators"

const router = Router()

// Apply rate limiting to all conversation routes
router.use(tieredApiLimiter)

// POST /api/v1/conversations - Create a new conversation
router.post("/", authenticate, async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  try {
    const validatedData = createConversationSchema.parse(req.body)
    const conversation = await createConversation(req.user.sub, validatedData.documentId, validatedData.title)

    res.status(201).json({
      success: true,
      data: conversation
    })
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid input data",
          details: error.errors
        }
      })
    }
    throw error
  }
})

// GET /api/v1/conversations - List conversations with pagination and latest message preview
router.get("/", authenticate, async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  try {
    const validatedQuery = listConversationsSchema.parse((req as any).sanitizedQuery || req.query)
    const result = await listConversations({
      ...validatedQuery,
      userId: req.user.sub
    })

    res.json({
      success: true,
      data: result.data,
      meta: result.meta
    })
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid query parameters",
          details: error.errors
        }
      })
    }
    throw error
  }
})

// GET /api/v1/conversations/:id - Get a specific conversation with messages
router.get("/:id", authenticate, async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  try {
    const { id } = conversationIdSchema.parse((req as any).sanitizedParams || req.params)
    const conversation = await getConversation(id, req.user.sub)

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Conversation not found"
        }
      })
    }

    res.json({
      success: true,
      data: conversation
    })
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid conversation ID",
          details: error.errors
        }
      })
    }
    throw error
  }
})

// PUT /api/v1/conversations/:id - Update conversation
router.put("/:id", authenticate, async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  try {
    const { id } = conversationIdSchema.parse((req as any).sanitizedParams || req.params)
    const validatedData = updateConversationSchema.parse(req.body)
    
    const conversation = await updateConversation(id, req.user.sub, validatedData)

    res.json({
      success: true,
      data: conversation
    })
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid input data",
          details: error.errors
        }
      })
    }
    throw error
  }
})

// DELETE /api/v1/conversations/:id - Soft delete conversation
router.delete("/:id", authenticate, async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  try {
    const { id } = conversationIdSchema.parse((req as any).sanitizedParams || req.params)
    await deleteConversation(id, req.user.sub)

    res.json({
      success: true,
      message: "Conversation deleted successfully"
    })
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid conversation ID",
          details: error.errors
        }
      })
    }
    throw error
  }
})

// POST /api/v1/conversations/:id/messages - Send a message (creates both user and assistant messages in transaction)
router.post("/:id/messages", authenticate, async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  try {
    const { id } = conversationIdSchema.parse((req as any).sanitizedParams || req.params)
    const { message } = sendMessageSchema.parse(req.body)
    
    // Get conversation to extract documentId
    const conversation = await prisma.conversation.findUnique({
      where: { id }
    })
    
    // Call RAG pipeline with proper data structure
    const result = await sendMessage({
      conversationId: id,
      userId: req.user.sub,
      content: message,
      documentId: conversation?.documentId,
      correlationId: `conv-${id}-${Date.now()}`
    })

    res.status(201).json({
      success: true,
      data: {
        userMessage: result.userMessage,
        assistantMessage: result.assistantMessage
      }
    })
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid input data",
          details: error.errors
        }
      })
    }
    
    if (error.message === 'Conversation not found') {
      return res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Conversation not found"
        }
      })
    }
    
    throw error
  }
})

export default router
