import { Worker, Job } from 'bullmq';
import { prisma } from '../lib/prisma';
import { customLogger } from '../lib/logger';
import { redisConnection } from './connection';
import { extractText, detectFormat } from '../lib/documentExtractor';
import { chunkDocument } from '../lib/chunker';
import { generateAndStoreEmbeddings } from '../services/embedding.service';
import { appEvents } from '../lib/events';

export interface DocumentProcessingJob {
  documentId: string;
  userId: string;
}

export const documentProcessingWorker = new Worker<DocumentProcessingJob>(
  'document-processing',
  async (job: Job<DocumentProcessingJob>) => {
    const { documentId, userId } = job.data;
    const startTime = Date.now();

    customLogger.info(`Starting document processing job`, {
      jobId: job.id,
      documentId,
      userId
    });

    try {
      // Step 1: Fetch document from database
      await job.updateProgress(10);
      const document = await prisma.document.findUniqueOrThrow({
        where: { id: documentId }
      });

      if (document.userId !== userId) {
        throw new Error('Unauthorized: document does not belong to user');
      }

      // Step 2: Update document status to processing
      await job.updateProgress(15);
      await prisma.document.update({
        where: { id: documentId },
        data: { status: 'processing' }
      });

      customLogger.info(`Document fetched for processing`, {
        jobId: job.id,
        documentId,
        filename: document.fileUrl
      });

      // Step 3: Extract text from content
      await job.updateProgress(30);
      const format = detectFormat(document.fileUrl || 'unknown.txt');
      const { text, pageCount } = await extractText(document.content, format);

      customLogger.info(`Text extracted`, {
        jobId: job.id,
        documentId,
        format,
        textLength: text.length,
        pageCount
      });

      // Step 4: Chunk the document
      await job.updateProgress(45);
      const chunks = chunkDocument(text, {
        maxTokens: 500,
        overlapTokens: 50,
        minChunkTokens: 10
      });

      customLogger.info(`Document chunked`, {
        jobId: job.id,
        documentId,
        chunkCount: chunks.length,
        avgTokens: Math.round(
          chunks.reduce((sum, c) => sum + c.tokenEstimate, 0) / chunks.length
        )
      });

      // Step 5: Store chunks in database
      await job.updateProgress(60);
      await prisma.$transaction(async (tx) => {
        // Delete existing chunks first
        await tx.chunk.deleteMany({ where: { documentId } });
        
        // Create new chunks
        await tx.chunk.createMany({
          data: chunks.map(chunk => ({
            documentId,
            index: chunk.index,
            content: chunk.text,
            tokenCount: chunk.tokenEstimate
          }))
        });
      });

      // Fetch the created chunks with their actual IDs
      const createdChunks = await prisma.chunk.findMany({
        where: { documentId },
        orderBy: { index: 'asc' }
      });

      customLogger.info(`Chunks stored in database`, {
        jobId: job.id,
        documentId,
        storedChunks: createdChunks.length
      });

      // Step 6: Generate embeddings
      await job.updateProgress(75);
      const embeddingResult = await generateAndStoreEmbeddings(
        createdChunks.map(chunk => ({
          id: chunk.id,
          content: chunk.content
        })),
        userId,
        documentId
      );

      customLogger.info(`Embeddings generated`, {
        jobId: job.id,
        documentId,
        tokensUsed: embeddingResult.tokensUsed,
        cost: embeddingResult.cost
      });

      // Step 7: Update document status to completed
      await job.updateProgress(90);
      await prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'completed',
          processedAt: new Date()
        }
      });

      // Step 8: Create usage log
      await prisma.usageLog.create({
        data: {
          userId,
          action: 'document_ingested',
          resourceType: 'document',
          resourceId: documentId,
          metadata: JSON.stringify({
            chunkCount: chunks.length,
            format,
            pageCount
          }),
          duration: Date.now() - startTime,
          cost: embeddingResult.cost > 0 ? embeddingResult.cost : null
        }
      });

      // Emit completion event
      appEvents.emit('doc:processed', {
        documentId,
        userId,
        chunkCount: chunks.length,
        format,
        pageCount,
        durationMs: Date.now() - startTime,
        correlationId: job.id
      });

      await job.updateProgress(100);

      const result = {
        success: true,
        documentId,
        chunksCreated: chunks.length,
        tokensProcessed: embeddingResult.tokensUsed,
        cost: embeddingResult.cost,
        processingTime: Date.now() - startTime
      };

      customLogger.info(`Document processing completed successfully`, {
        jobId: job.id,
        documentId,
        ...result
      });

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      customLogger.error(`Document processing failed`, {
        jobId: job.id,
        documentId,
        error: errorMessage,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts
      });

      // Update document status to failed only on final attempt
      if (job.attemptsMade >= (job.opts.attempts || 3) - 1) {
        await prisma.document.update({
          where: { id: documentId },
          data: { 
            status: 'failed',
            error: errorMessage
          }
        }).catch(err => {
          customLogger.error(`Failed to update document error status`, {
            documentId,
            error: err.message
          });
        });
      }

      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 3, // Process up to 3 documents simultaneously
    removeOnComplete: { count: 100 }, // Keep last 100 completed jobs
    removeOnFail: { count: 50 }, // Keep last 50 failed jobs
    defaultJobOptions: {
      attempts: 3, // Retry up to 3 times
      backoff: {
        type: 'exponential',
        delay: 2000 // Start with 2s, then 4s, then 8s
      }
    }
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
