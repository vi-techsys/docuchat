import { prisma } from '../lib/prisma';
import { TextExtractionService, ExtractedText } from './text-extraction.service';
import { ChunkingService, Chunk } from './chunking.service';
import { generateAndStoreEmbeddings } from './embedding.service';
import { logDocumentCreated, logDocumentUpdated } from '../events/document.events';
import { customLogger } from '../lib/logger';

export interface DocumentProcessingOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  userId: string;
}

export interface ProcessingResult {
  documentId: string;
  chunksCreated: number;
  tokensProcessed: number;
  processingTime: number;
  metadata: ExtractedText['metadata'];
}

export class DocumentProcessingService {
  static async processDocument(
    filePath: string,
    mimeType: string,
    originalName: string,
    options: DocumentProcessingOptions
  ): Promise<ProcessingResult> {
    const startTime = Date.now();

    try {
      customLogger.info(`Starting document processing for: ${originalName}`);

      // 1. Extract text from file
      const extracted = await TextExtractionService.extractText(filePath, mimeType, originalName);
      
      // 2. Create document record
      const document = await prisma.document.create({
        data: {
          userId: options.userId,
          title: originalName,
          content: extracted.text,
          status: 'processing',
          mimeType,
          fileSize: extracted.metadata.fileSize
        }
      });

      // 3. Create chunks
      const chunks = await ChunkingService.createChunks(extracted.text, {
        chunkSize: options.chunkSize,
        chunkOverlap: options.chunkOverlap
      });

      // 4. Store chunks in database
      const chunkRecords = await prisma.$transaction(
        chunks.map(chunk =>
          prisma.chunk.create({
            data: {
              documentId: document.id,
              index: chunk.index,
              content: chunk.content,
              tokenCount: chunk.tokenCount
            }
          })
        )
      );

      // 5. Generate and store embeddings
      await generateAndStoreEmbeddings(
        chunkRecords.map(chunk => ({
          id: chunk.id,
          content: chunk.content
        })),
        options.userId,
        document.id
      );

      // 6. Update document status to completed
      const updatedDocument = await prisma.document.update({
        where: { id: document.id },
        data: { 
          status: 'completed',
          processedAt: new Date()
        }
      });

      const processingTime = Date.now() - startTime;
      const stats = ChunkingService.getChunkingStats(chunks);

      customLogger.info(`Document processing completed: documentId=${document.id}, fileName=${originalName}, chunksCreated=${chunks.length}, tokensProcessed=${stats.totalTokens}, processingTimeMs=${processingTime}`);

      // Log event
      await logDocumentCreated(options.userId, document.id, originalName, 'completed');

      return {
        documentId: document.id,
        chunksCreated: chunks.length,
        tokensProcessed: stats.totalTokens,
        processingTime,
        metadata: extracted.metadata
      };

    } catch (error) {
      customLogger.error(`Document processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      // If document was created, update its status to failed
      // This is a simplified approach - in production you'd want better error handling
      throw error;
    }
  }

  static async reprocessDocument(
    documentId: string,
    userId: string
  ): Promise<ProcessingResult> {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { chunks: true }
    });

    if (!document) {
      throw new Error('Document not found');
    }

    if (document.userId !== userId) {
      throw new Error('Unauthorized to reprocess this document');
    }

    // Delete existing chunks
    await prisma.chunk.deleteMany({
      where: { documentId }
    });

    // Update status to processing
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'processing' }
    });

    // Reprocess with existing content
    const chunks = await ChunkingService.createChunks(document.content);
    
    // Store new chunks
    const chunkRecords = await prisma.$transaction(
      chunks.map(chunk =>
        prisma.chunk.create({
          data: {
            documentId,
            index: chunk.index,
            content: chunk.content,
            tokenCount: chunk.tokenCount
          }
        })
      )
    );

    // Generate embeddings
    await generateAndStoreEmbeddings(
      chunkRecords.map(chunk => ({
        id: chunk.id,
        content: chunk.content
      })),
      userId,
      documentId
    );

    // Update document status
    const updatedDocument = await prisma.document.update({
      where: { id: documentId },
      data: { 
        status: 'completed',
        processedAt: new Date()
      }
    });

    const stats = ChunkingService.getChunkingStats(chunks);

    await logDocumentUpdated(userId, documentId, {
      action: 'reprocessed',
      chunksCreated: chunks.length,
      tokensProcessed: stats.totalTokens
    });

    return {
      documentId,
      chunksCreated: chunks.length,
      tokensProcessed: stats.totalTokens,
      processingTime: 0, // Not tracked for reprocessing
      metadata: {
        fileName: document.title,
        fileSize: document.fileSize || 0,
        mimeType: document.mimeType || 'unknown'
      }
    };
  }

  static async getProcessingStatus(documentId: string): Promise<{
    status: string;
    chunksProcessed: number;
    totalChunks: number;
    progress: number;
  }> {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        chunks: {
          select: { id: true }
        }
      }
    });

    if (!document) {
      throw new Error('Document not found');
    }

    const chunksProcessed = document.chunks.length;
    const totalChunks = chunksProcessed; // Simplified - in real implementation you'd track this separately

    return {
      status: document.status,
      chunksProcessed,
      totalChunks,
      progress: totalChunks > 0 ? (chunksProcessed / totalChunks) * 100 : 0
    };
  }
}
