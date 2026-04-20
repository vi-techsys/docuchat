/// <reference path="../types/express.d.ts">
import { Router } from "express"
import type { Request, Response } from "express"
import { authenticate } from "../middleware/auths"
import { createDocument, listDocuments, getDocument, updateDocument, deleteDocument } from "../services/document.services"
import { createDocumentSchema, updateDocumentSchema, listDocumentsSchema, documentIdSchema } from "../validators/document.validators"
import { queueDocumentForProcessing } from "../queues/document.queue"

const router = Router()

// POST /api/v1/documents - Create a new document
router.post("/", authenticate, async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  try {
    const validatedData = createDocumentSchema.parse(req.body)
    const doc = await createDocument(req.user.sub, validatedData)

    // Queue document for processing
    await queueDocumentForProcessing(doc.id, req.user.sub)

    res.status(202).json({
      success: true,
      data: doc,
      message: "Document uploaded successfully and queued for processing"
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

// GET /api/v1/documents - List documents with pagination, filtering, and sorting
router.get("/", authenticate, async (req: Request, res: Response) => {
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
router.get("/:id", authenticate, async (req: Request, res: Response) => {
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
router.put("/:id", authenticate, async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error("User not authenticated")
  }

  try {
    const { id } = documentIdSchema.parse(req.params)
    const validatedData = updateDocumentSchema.parse(req.body)
    
    const doc = await updateDocument(id, req.user.sub, validatedData)

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
          message: "Invalid input data",
          details: error.errors
        }
      })
    }
    throw error
  }
})

// DELETE /api/v1/documents/:id - Soft delete a document
router.delete("/:id", authenticate, async (req: Request, res: Response) => {
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