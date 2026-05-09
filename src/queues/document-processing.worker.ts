import { Worker, Job } from 'bullmq';
import { prisma } from '../lib/prisma';
import { DocumentProcessingService } from '../services/document-processing.service';
import { saveUploadedFile } from '../middleware/upload.middleware';
import { customLogger } from '../lib/logger';
import { redisConnection } from './connection';

export interface DocumentProcessingJob {
  documentId: string;
  filePath: string;
  mimeType: string;
  originalName: string;
  userId: string;
  chunkSize?: number;
  chunkOverlap?: number;
}

export const documentProcessingWorker = new Worker<DocumentProcessingJob>(
  'document-processing',
  async (job: Job<DocumentProcessingJob>) => {
    const { documentId, filePath, mimeType, originalName, userId, chunkSize, chunkOverlap } = job.data;
    
    customLogger.info(`Starting document processing job`, {
      jobId: job.id,
      documentId,
      fileName: originalName,
      userId
    });

    try {
      // Update document status to processing
      await prisma.document.update({
        where: { id: documentId },
        data: { status: 'processing' }
      });

      // Process the document
      const result = await DocumentProcessingService.processDocument(
        filePath,
        mimeType,
        originalName,
        {
          userId,
          chunkSize,
          chunkOverlap
        }
      );

      customLogger.info(`Document processing job completed`, {
        jobId: job.id,
        documentId,
        chunksCreated: result.chunksCreated,
        tokensProcessed: result.tokensProcessed,
        processingTime: result.processingTime
      });

      return result;

    } catch (error) {
      customLogger.error(`Document processing job failed`, {
        jobId: job.id,
        documentId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Update document status to failed
      await prisma.document.update({
        where: { id: documentId },
        data: { status: 'failed' }
      });

      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 3, // Process up to 3 documents simultaneously
    removeOnComplete: { count: 100 }, // Keep last 100 completed jobs
    removeOnFail: { count: 50 } // Keep last 50 failed jobs
  }
);

// Handle worker events
documentProcessingWorker.on('completed', (job: Job<DocumentProcessingJob>, result: any) => {
  customLogger.info(`Document processing worker completed job`, {
    jobId: job.id,
    documentId: job.data.documentId,
    result
  });
});

documentProcessingWorker.on('failed', (job: Job<DocumentProcessingJob> | undefined, err: Error) => {
  customLogger.error(`Document processing worker failed job`, {
    jobId: job?.id,
    documentId: job?.data.documentId,
    error: err.message
  });
});

documentProcessingWorker.on('error', (err: Error) => {
  customLogger.error(`Document processing worker error`, {
    error: err.message
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  customLogger.info('Closing document processing worker...');
  await documentProcessingWorker.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  customLogger.info('Closing document processing worker...');
  await documentProcessingWorker.close();
  process.exit(0);
});

export default documentProcessingWorker;
