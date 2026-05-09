import { Worker, Job } from 'bullmq';
import { redisConnection } from './connection';
import { prisma } from '../lib/prisma';
import { customLogger as logger } from '../lib/logger';
import { appEvents } from '../lib/events';
import { extractText, detectFormat } from '../lib/documentExtractor';
import { chunkDocument } from '../lib/chunker';
import {
  generateEmbeddingCached,
  generateAndStoreEmbeddings,
} from '../services/embedding.service';

const worker = new Worker(
  'document-processing',
  async (job: Job) => {
    const { documentId, userId, correlationId } = job.data;
    const startTime = Date.now();

    logger.info('Document processing started', {
      correlationId, documentId, userId,
    });

    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'processing' },
    });

    try {
      // Step 1: Fetch document
      const doc = await prisma.document.findUniqueOrThrow({
        where: { id: documentId },
      });
      await job.updateProgress(5);

      // Step 2: Extract text
      const format = detectFormat(doc.filename || 'unknown.txt');
      const { text, pageCount } = await extractText(doc.content, format);
      await job.updateProgress(15);

      logger.info('Text extracted', {
        correlationId, documentId, format,
        textLength: text.length, pageCount,
      });

      // Step 3: Chunk the text
      const chunks = chunkDocument(text, {
        maxTokens: 500,
        overlapTokens: 50,
        minChunkTokens: 50,
      });
      await job.updateProgress(30);

      logger.info('Document chunked', {
        correlationId, documentId,
        chunkCount: chunks.length,
        avgTokens: Math.round(
          chunks.reduce((sum, c) => sum + c.tokenEstimate, 0) / chunks.length
        ),
      });

      // Step 4: Store chunks in database
      const chunkRecords = await prisma.$transaction(async (tx) => {
        await tx.chunk.deleteMany({ where: { documentId } });
        return await tx.chunk.createMany({
          data: chunks.map(chunk => ({
            documentId,
            index: chunk.index,
            content: chunk.text,
            tokenCount: chunk.tokenEstimate,
          })),
        });
      });
      await job.updateProgress(50);

      // Step 5: Generate embeddings (the expensive step)
      const chunkTexts = chunks.map(c => c.text);
      await generateAndStoreEmbeddings(
        chunks.map(chunk => ({
          id: chunk.index.toString(), // Temporary ID, will be updated after creation
          content: chunk.text
        })),
        userId,
        documentId
      );
      await job.updateProgress(85);

      // Step 6: Mark complete
      await prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'completed',
          chunkCount: chunks.length,
          processedAt: new Date(),
        },
      });
      await job.updateProgress(95);

      const duration = Date.now() - startTime;

      // Emit completion event with metrics
      appEvents.emit('doc:processed', {
        documentId,
        userId,
        correlationId,
        chunkCount: chunks.length,
        durationMs: duration,
        format,
        pageCount,
      });

      logger.info('Document processing complete', {
        correlationId, documentId,
        chunkCount: chunks.length, durationMs: duration,
      });

      return {
        success: true,
        chunks: chunks.length,
        durationMs: duration,
      };

    } catch (error) {
      if (job.attemptsMade >= (job.opts.attempts ?? 3) - 1) {
        await prisma.document.update({
          where: { id: documentId },
          data: {
            status: 'failed',
            error: (error as Error).message,
          },
        });
      }
      logger.error('Document processing failed', {
        correlationId, documentId,
        error: (error as Error).message,
        attempt: job.attemptsMade + 1,
      });
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 3,
  }
);

export default worker;
