/// <reference path="../types/express.d.ts">
import { Router } from "express"
import type { Request, Response } from "express"
import { authenticate } from "../middleware/auths"
import { 
  createMessage, 
  getMessages, 
  getMessageById, 
  updateMessage, 
  softDeleteMessage 
} from "../services/message.services"

const router = Router()

// POST /api/v1/conversations/:conversationId/messages - Create a new message
router.post("/:conversationId/messages", authenticate, async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  const { conversationId } = req.params
  const { content, role } = req.body

  if (!content || !role) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "content and role are required"
      }
    })
  }

  if (!["user", "assistant"].includes(role)) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "role must be either 'user' or 'assistant'"
      }
    })
  }

  try {
    const message = await createMessage(conversationId, content, role)

    res.status(201).json({
      success: true,
      data: message
    })
  } catch (error: any) {
    throw error
  }
})

// GET /api/v1/conversations/:conversationId/messages - Get all messages for a conversation
router.get("/:conversationId/messages", authenticate, async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  const { conversationId } = req.params

  try {
    const messages = await getMessages(conversationId, req.user.sub)

    res.json({
      success: true,
      data: messages
    })
  } catch (error: any) {
    throw error
  }
})

// GET /api/v1/conversations/:conversationId/messages/:messageId - Get a specific message
router.get("/:conversationId/messages/:messageId", authenticate, async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  const { conversationId, messageId } = req.params

  try {
    const message = await getMessageById(messageId, conversationId, req.user.sub)

    if (!message) {
      return res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Message not found"
        }
      })
    }

    res.json({
      success: true,
      data: message
    })
  } catch (error: any) {
    throw error
  }
})

// PUT /api/v1/conversations/:conversationId/messages/:messageId - Update a message
router.put("/:conversationId/messages/:messageId", authenticate, async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  const { conversationId, messageId } = req.params
  const { content } = req.body

  if (!content) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "content is required"
      }
    })
  }

  try {
    const message = await updateMessage(messageId, conversationId, req.user.sub, { content })

    res.json({
      success: true,
      data: message
    })
  } catch (error: any) {
    throw error
  }
})

// DELETE /api/v1/conversations/:conversationId/messages/:messageId - Soft delete a message
router.delete("/:conversationId/messages/:messageId", authenticate, async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  const { conversationId, messageId } = req.params

  try {
    await softDeleteMessage(messageId, conversationId, req.user.sub)

    res.json({
      success: true,
      message: "Message deleted successfully"
    })
  } catch (error: any) {
    throw error
  }
})

export default router
