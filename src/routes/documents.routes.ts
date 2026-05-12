/// <reference path="../types/express.d.ts">
import { Router } from "express"
import type { Request, Response } from "express"
import { authenticate } from "../middleware/auths"
import multer from "multer"
import { createDocument, listDocuments, getDocument, updateDocument, deleteDocument } from "../services/document.services"
import { createDocumentSchema, updateDocumentSchema, listDocumentsSchema, documentIdSchema } from "../validators/document.validators"
import { queueDocumentForProcessing } from "../queues/document.queue"
import { privateCache, invalidateCache } from "../middleware/cache.middleware"
import { prisma } from "../lib/prisma"
import { customLogger } from "../lib/logger"
import { generateAndStoreEmbeddings } from "../services/embedding.service"
import { chunkDocument } from "../lib/chunker"
import { extractText, detectFormat } from "../lib/documentExtractor"
import { appEvents } from "../lib/events"

const router = Router()

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept common document formats
    const allowedTypes = [
      'text/plain',
      'text/markdown',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`))
    }
  }
})

// POST /api/v1/documents - Create a new document (file upload or direct text)
router.post("/", authenticate, upload.single('file'), async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  const userId = req.user.sub

  try {
    let title: string
    let content: string
    let filename: string | undefined
    let mimeType: string | undefined
    let fileSize: number | undefined

    // Check if this is a file upload or direct text content
    if (req.file) {
      // File upload case
      const file = req.file
      title = req.body.title || file.originalname
      
      // For binary files (PDFs, Word docs), keep buffer as-is for text extraction
      // For text files, convert to string with proper encoding handling
      if (file.mimetype === 'text/plain' || file.mimetype === 'text/markdown') {
        content = file.buffer.toString('utf-8')
        // Remove null bytes and other problematic characters
        content = content.replace(/\x00/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      } else {
        // For binary files, store as base64 for now, will be processed by extractText
        content = file.buffer.toString('base64')
      }
      
      filename = file.originalname
      mimeType = file.mimetype
      fileSize = file.size

      customLogger.info(`File upload initiated`, {
        userId,
        filename,
        mimeType,
        fileSize
      })
    } else if (req.body.title && req.body.content) {
      // Direct text content case
      title = req.body.title
      content = req.body.content
      filename = `${title.toLowerCase().replace(/\s+/g, '-')}.txt`
      mimeType = 'text/plain'
      fileSize = content.length

      customLogger.info(`Direct text upload initiated`, {
        userId,
        title,
        contentLength: content.length
      })
    } else {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_DATA',
          message: 'Either file upload or title and content are required'
        }
      })
    }

    // Create document record
    const document = await prisma.document.create({
      data: {
        user: {
          connect: { id: userId }
        },
        title,
        content,
        status: 'processing',
        mimeType: mimeType || 'text/plain',
        fileSize: fileSize || content.length
      }
    })

    // Process document using new ingestion pipeline
    let chunks: any[]
    let pageCount: number | undefined

    try {
      if (filename && mimeType !== 'text/plain') {
        // Extract text from file (PDF, Markdown, etc.)
        const format = detectFormat(filename)
        const extracted = await extractText(content, format)
        content = extracted.text
        pageCount = extracted.pageCount
      }

      // Chunk the text
      chunks = chunkDocument(content, {
        maxTokens: 500,
        overlapTokens: 50,
        minChunkTokens: 10, // Lower minimum for short documents
      })

    } catch (processingError) {
      // Mark document as failed if processing fails
      await prisma.document.update({
        where: { id: document.id },
        data: {
          status: 'failed',
          error: processingError instanceof Error ? processingError.message : 'Unknown processing error'
        }
      })

      throw processingError
    }

    // Create chunks in database
    const chunkRecords = await prisma.$transaction(
      chunks.map((chunk, index) =>
        prisma.chunk.create({
          data: {
            documentId: document.id,
            index: chunk.index,
            content: chunk.text,
            tokenCount: chunk.tokenEstimate
          }
        })
      )
    )

    // Generate embeddings and get actual costs
    const startTime = Date.now();
    const embeddingResult = await generateAndStoreEmbeddings(
      chunkRecords.map(chunk => ({
        id: chunk.id,
        content: chunk.content
      })),
      userId,
      document.id
    )
    const processingDuration = Date.now() - startTime;

    // Use the actual cost from OpenAI
    const actualCost = embeddingResult.cost;
    const totalTokens = embeddingResult.tokensUsed;

    // Update document status to completed
    await prisma.document.update({
      where: { id: document.id },
      data: {
        status: 'completed',
        processedAt: new Date()
      }
    })

    // Create usage log with actual cost directly
    await prisma.usageLog.create({
      data: {
        userId: userId,
        action: 'document_ingested',
        resourceType: 'document',
        resourceId: document.id,
        metadata: JSON.stringify({
          chunkCount: chunkRecords.length,
          format: filename ? detectFormat(filename) : 'text',
          pageCount: pageCount,
          totalTokens: totalTokens,
        }),
        duration: processingDuration,
        cost: actualCost > 0 ? actualCost : null,
      },
    });

    customLogger.info('Usage log created with actual costs', {
      documentId: document.id,
      chunkCount: chunkRecords.length,
      totalTokens,
      actualCost: `$${actualCost.toFixed(6)}`,
      processingDuration
    });

    customLogger.info(`Document processing completed`, {
      documentId: document.id,
      chunksCreated: chunkRecords.length,
      tokensProcessed: chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0)
    })

    res.status(201).json({
      success: true,
      data: {
        documentId: document.id,
        title,
        status: 'completed',
        chunksCreated: chunkRecords.length,
        tokensProcessed: chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0),
        message: 'Document processed successfully with real OpenAI embeddings'
      }
    })

  } catch (error: any) {
    customLogger.error(`Document upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
      stack: error instanceof Error ? error.stack : 'No stack trace'
    })

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

    return res.status(500).json({
      success: false,
      error: {
        code: 'UPLOAD_FAILED',
        message: 'Failed to upload document',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    })
  }
})

// GET /api/v1/documents - List documents with pagination, filtering, and sorting
router.get("/", authenticate, privateCache(300), async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  try {
    const validatedQuery = listDocumentsSchema.parse(req.query)
    const result = await listDocuments({
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

// GET /api/v1/documents/:id - Get a specific document
router.get("/:id", authenticate, privateCache(600), async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  try {
    const { id } = documentIdSchema.parse(req.params)
    const doc = await getDocument(id, req.user.sub)

    if (!doc) {
      return res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Document not found"
        }
      })
    }

    res.json({
      success: true,
      data: doc
    })
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid document ID",
          details: error.errors
        }
      })
    }
    throw error
  }
})

// PUT /api/v1/documents/:id - Update a document
router.put("/:id", authenticate, invalidateCache(['doc:*', 'doc:list:*']), async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  try {
    const { id } = documentIdSchema.parse(req.params)
    const validatedData = updateDocumentSchema.parse(req.body)
    
    // Get the current document to check if content is being updated
    const currentDoc = await getDocument(id, req.user.sub)
    if (!currentDoc) {
      return res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Document not found"
        }
      })
    }

    let updateData = { ...validatedData }
    
    // If content is being updated, we need to re-process the document
    if (validatedData.content) {
      // Clean the content to prevent encoding issues
      const cleanedContent = validatedData.content
        .replace(/\x00/g, '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      
      updateData.content = cleanedContent
      updateData.status = 'processing' // Reset status for re-processing

      // First update the document with new content and status
      const updatedDoc = await updateDocument(id, req.user.sub, {
        content: cleanedContent,
        status: 'processing'
      })

      try {
        // Re-chunk the updated content
        const chunks = chunkDocument(cleanedContent, {
          maxTokens: 500,
          overlapTokens: 50,
          minChunkTokens: 10,
        })

        // Delete existing chunks and embeddings
        await prisma.chunk.deleteMany({
          where: { documentId: id }
        })

        // Create new chunks
        const chunkRecords = await prisma.$transaction(
          chunks.map((chunk, index) =>
            prisma.chunk.create({
              data: {
                documentId: id,
                index: chunk.index,
                content: chunk.text,
                tokenCount: chunk.tokenEstimate
              }
            })
          )
        )

        // Generate new embeddings
        const embeddingResult = await generateAndStoreEmbeddings(
          chunkRecords.map(chunk => ({
            id: chunk.id,
            content: chunk.content
          })),
          req.user.sub,
          id
        )

        // Update document status to completed
        await prisma.document.update({
          where: { id, userId: req.user.sub },
          data: {
            status: 'completed',
            processedAt: new Date()
          }
        })

        // Log the content update
        await prisma.usageLog.create({
          data: {
            userId: req.user.sub,
            action: 'document_content_updated',
            resourceType: 'document',
            resourceId: id,
            metadata: JSON.stringify({
              chunkCount: chunkRecords.length,
              totalTokens: embeddingResult.tokensUsed,
            }),
            cost: embeddingResult.cost > 0 ? embeddingResult.cost : null,
          },
        })

      } catch (processingError) {
        // Mark document as failed if re-processing fails
        await prisma.document.update({
          where: { id, userId: req.user.sub },
          data: {
            status: 'failed',
            error: processingError instanceof Error ? processingError.message : 'Unknown processing error'
          }
        })
        throw processingError
      }
    }

    // Update other fields (title, status) if provided
    if (validatedData.title || (validatedData.status && !validatedData.content)) {
      const finalDoc = await updateDocument(id, req.user.sub, updateData)
      
      // Log title-only updates
      if (validatedData.title && !validatedData.content) {
        await prisma.usageLog.create({
          data: {
            userId: req.user.sub,
            action: 'document_title_updated',
            resourceType: 'document',
            resourceId: id,
            metadata: JSON.stringify({
              oldTitle: currentDoc.title,
              newTitle: validatedData.title
            })
          },
        })
      }
    }

    // Get the final updated document
    const finalDoc = await getDocument(id, req.user.sub)

    res.json({
      success: true,
      data: finalDoc
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

// DELETE /api/v1/documents/:id - Soft delete a document
router.delete("/:id", authenticate, invalidateCache(['doc:*', 'doc:list:*']), async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  try {
    const { id } = documentIdSchema.parse(req.params)
    await deleteDocument(id, req.user.sub)

    res.json({
      success: true,
      message: "Document deleted successfully"
    })
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid document ID",
          details: error.errors
        }
      })
    }
    throw error
  }
})

// GET /api/v1/documents/:id/processing-status - Get document processing status and progress
router.get("/:id/processing-status", authenticate, async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  try {
    const { id } = documentIdSchema.parse(req.params)
    const doc = await getDocument(id, req.user.sub)

    if (!doc) {
      return res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Document not found"
        }
      })
    }

    // Try to get job status from queue
    let jobStatus = null
    try {
      const { getJobsByDocumentId } = await import("../queues/document.queue")
      const jobs = await getJobsByDocumentId(id)
      if (jobs.length > 0) {
        const latestJob = jobs[0]
        jobStatus = {
          jobId: latestJob.id,
          state: await latestJob.getState(),
          progress: latestJob.progress,
          processedOn: latestJob.processedOn,
          finishedOn: latestJob.finishedOn,
          failedReason: latestJob.failedReason
        }
      }
    } catch (error) {
      // Queue might not be available, ignore
    }

    res.json({
      success: true,
      data: {
        documentId: doc.id,
        status: doc.status,
        jobStatus
      }
    })
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid document ID",
          details: error.errors
        }
      })
    }
    throw error
  }
})

export default router