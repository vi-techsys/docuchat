/// <reference path="../types/express.d.ts">
import { Router } from "express"
import type { Request, Response, NextFunction } from "express"
import { authenticate } from "../middleware/auths"
import { prisma } from "../lib/prisma"
import { runAgent } from "../agents/executor"
import { z } from 'zod'

const router = Router()

// Agent request schema
const agentRequestSchema = z.object({
  question: z.string().min(1).max(1000),
  documentId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional()
})

// POST /api/v1/agent/chat - Run agent with tools
router.post("/chat", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  try {
    const validatedData = agentRequestSchema.parse(req.body)
    
    // Get conversation history if conversationId provided
    let conversationHistory: Array<{ role: string; content: string }> = [];
    if (validatedData.conversationId) {
      const conversation = await prisma.conversation.findUnique({
        where: { id: validatedData.conversationId },
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: { role: true, content: true }
          }
        }
      });

      if (conversation && conversation.userId === req.user?.sub) {
        conversationHistory = conversation.messages.reverse();
      }
    }

    // Run agent
    const startTime = Date.now();
    const result = await runAgent({
      userId: req.user.sub,
      question: validatedData.question,
      conversationHistory,
      documentId: validatedData.documentId,
      correlationId: `agent-${Date.now()}`
    })

    // Save to conversation if provided
    let savedMessages = null;
    if (validatedData.conversationId) {
      savedMessages = await prisma.$transaction(async (tx) => {
        // Save user message
        const userMessage = await tx.message.create({
          data: {
            conversationId: validatedData.conversationId!,
            role: 'user',
            content: validatedData.question,
            tokenCount: Math.ceil(validatedData.question.length / 4),
            model: null,
            temperature: null,
          },
        });

        // Save assistant message with metadata
        const assistantMessage = await tx.message.create({
          data: {
            conversationId: validatedData.conversationId!,
            role: 'assistant',
            content: result.answer,
            tokenCount: result.tokensUsed.output,
            model: 'gpt-4o',
            temperature: 0.1,
          },
        });

        // Log usage
        await tx.usageLog.create({
          data: {
            userId: req.user.sub,
            action: 'agent_chat_sent',
            resourceId: validatedData.conversationId!,
            resourceType: 'conversation',
            cost: result.costUsd,
            duration: result.processingTime,
            metadata: JSON.stringify({
              toolCalls: result.toolCalls.length,
              sources: result.sources,
              confidence: result.confidence,
              tokensUsed: result.tokensUsed,
              processingTime: result.processingTime
            })
          }
        });

        // Update conversation
        await tx.conversation.update({
          where: { id: validatedData.conversationId },
          data: { 
            updatedAt: new Date(),
            lastMessageAt: new Date()
          },
        });

        return {
          userMessage,
          assistantMessage
        };
      });
    }

    res.status(201).json({
      success: true,
      data: {
        answer: result.answer,
        sources: result.sources,
        confidence: result.confidence,
        metadata: {
          iterations: result.iterations,
          costUsd: result.costUsd,
          terminationReason: result.terminationReason,
          toolsUsed: result.trace
            .filter((s: any) => s.tool)
            .map((s: any) => s.tool),
          confidence: result.confidence,
          durationMs: Date.now() - startTime,
        },
      },
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

export default router
