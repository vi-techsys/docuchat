/// <reference path="../types/express.d.ts">
import { Router } from "express"
import type { Request, Response } from "express"
import { authenticate } from "../middleware/auths"
import { 
  createConversation, 
  getConversations, 
  getConversationById, 
  updateConversation, 
  softDeleteConversation 
} from "../services/conversation.services"

const router = Router()

// POST /api/v1/conversations - Create a new conversation
router.post("/", authenticate, async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  const { documentId, title } = req.body

  if (!documentId || !title) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "documentId and title are required"
      }
    })
  }

  try {
    const conversation = await createConversation(req.user.sub, documentId, title)

    res.status(201).json({
      success: true,
      data: conversation
    })
  } catch (error: any) {
    throw error
  }
})

// GET /api/v1/conversations - Get all conversations for a user
router.get("/", authenticate, async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  const { documentId } = req.query

  try {
    const conversations = await getConversations(
      req.user.sub, 
      documentId as string
    )

    res.json({
      success: true,
      data: conversations
    })
  } catch (error: any) {
    throw error
  }
})

// GET /api/v1/conversations/:id - Get a specific conversation with messages
router.get("/:id", authenticate, async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  const { id } = req.params

  try {
    const conversation = await getConversationById(id, req.user.sub)

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
    throw error
  }
})

// PUT /api/v1/conversations/:id - Update conversation
router.put("/:id", authenticate, async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  const { id } = req.params
  const { title } = req.body

  if (!title) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "title is required"
      }
    })
  }

  try {
    const conversation = await updateConversation(id, req.user.sub, { title })

    res.json({
      success: true,
      data: conversation
    })
  } catch (error: any) {
    throw error
  }
})

// DELETE /api/v1/conversations/:id - Soft delete conversation
router.delete("/:id", authenticate, async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  const { id } = req.params

  try {
    await softDeleteConversation(id, req.user.sub)

    res.json({
      success: true,
      message: "Conversation deleted successfully"
    })
  } catch (error: any) {
    throw error
  }
})

export default router
