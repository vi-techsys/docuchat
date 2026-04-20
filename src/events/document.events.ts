import { prisma } from '../lib/prisma'

export interface DocumentEvent {
  userId: string
  action: 'document_created' | 'document_updated' | 'document_deleted'
  documentId: string
  metadata?: Record<string, any>
}

export async function logDocumentEvent(event: DocumentEvent) {
  try {
    await prisma.usageLog.create({
      data: {
        userId: event.userId,
        action: event.action,
        resourceId: event.documentId,
        resourceType: 'document',
        metadata: event.metadata || {}
      }
    })
    
    console.log(`Document event logged: ${event.action} for document ${event.documentId}`)
  } catch (error) {
    console.error('Failed to log document event:', error)
    // Don't throw error - logging failures shouldn't break the main flow
  }
}

export async function logDocumentCreated(userId: string, documentId: string, title: string, status: string) {
  return logDocumentEvent({
    userId,
    action: 'document_created',
    documentId,
    metadata: {
      title,
      status,
      timestamp: new Date().toISOString()
    }
  })
}

export async function logDocumentUpdated(userId: string, documentId: string, changes: Record<string, any>) {
  return logDocumentEvent({
    userId,
    action: 'document_updated',
    documentId,
    metadata: {
      changes,
      timestamp: new Date().toISOString()
    }
  })
}

export async function logDocumentDeleted(userId: string, documentId: string, title: string, status: string) {
  return logDocumentEvent({
    userId,
    action: 'document_deleted',
    documentId,
    metadata: {
      title,
      status,
      timestamp: new Date().toISOString()
    }
  })
}
