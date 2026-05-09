import { prisma } from '../lib/prisma';
import { generateEmbeddingCached } from './embedding.service';
import { customLogger } from '../lib/logger';

export interface RAGQuery {
  question: string;
  userId: string;
  documentId?: string;
  maxChunks?: number; // Default: 5
}

export interface RAGResult {
  answer: string;
  sources: Array<{
    chunkId: string;
    content: string;
    similarity: number;
    documentTitle: string;
  }>;
  query: string;
  metadata: {
    chunksRetrieved: number;
    processingTime: number;
    model: string;
  };
}

export class RAGService {
  private static readonly DEFAULT_MAX_CHUNKS = 5;
  private static readonly SIMILARITY_THRESHOLD = 0.7;

  static async query(query: RAGQuery): Promise<RAGResult> {
    const startTime = Date.now();
    const maxChunks = query.maxChunks || this.DEFAULT_MAX_CHUNKS;

    try {
      customLogger.info(`RAG query initiated`, {
        userId: query.userId,
        documentId: query.documentId,
        question: query.question.substring(0, 100) + (query.question.length > 100 ? '...' : '')
      });

      // 1. Generate embedding for the question
      const questionEmbedding = await generateEmbeddingCached(
        query.question,
        query.userId
      );

      // 2. Search for similar chunks using vector similarity
      const similarChunks = await this.findSimilarChunks(
        questionEmbedding,
        query.userId,
        query.documentId,
        maxChunks
      );

      if (similarChunks.length === 0) {
        return {
          answer: 'I could not find relevant information to answer your question.',
          sources: [],
          query: query.question,
          metadata: {
            chunksRetrieved: 0,
            processingTime: Date.now() - startTime,
            model: 'text-embedding-3-small'
          }
        };
      }

      // 3. Assemble context from retrieved chunks
      const context = similarChunks
        .map((chunk, index) => `[${index + 1}] ${chunk.content}`)
        .join('\n\n');

      // 4. Generate answer using context (mock implementation for now)
      const answer = await this.generateAnswer(query.question, context);

      const processingTime = Date.now() - startTime;

      customLogger.info(`RAG query completed`, {
        userId: query.userId,
        chunksRetrieved: similarChunks.length,
        processingTime,
        answerLength: answer.length
      });

      return {
        answer,
        sources: similarChunks.map(chunk => ({
          chunkId: chunk.id,
          content: chunk.content,
          similarity: chunk.similarity || 0,
          documentTitle: chunk.documentTitle || 'Unknown Document'
        })),
        query: query.question,
        metadata: {
          chunksRetrieved: similarChunks.length,
          processingTime,
          model: 'text-embedding-3-small'
        }
      };

    } catch (error) {
      customLogger.error(`RAG query failed`, {
        userId: query.userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        answer: 'Sorry, I encountered an error while processing your question.',
        sources: [],
        query: query.question,
        metadata: {
          chunksRetrieved: 0,
          processingTime: Date.now() - startTime,
          model: 'text-embedding-3-small'
        }
      };
    }
  }

  private static async findSimilarChunks(
    questionEmbedding: number[],
    userId: string,
    documentId?: string,
    limit: number = 5
  ): Promise<Array<{
    id: string;
    content: string;
    similarity?: number;
    documentTitle?: string;
  }>> {
    const vectorStr = `[${questionEmbedding.join(',')}]`;

    // Build WHERE clause for document filtering
    const whereClause = documentId
      ? `AND c.documentId = ${documentId}`
      : `AND d.userId = ${userId}`;

    const query = `
      SELECT 
        c.id,
        c.content,
        c.documentId,
        d.title as documentTitle,
        1 - (c.embedding <=> ${vectorStr}::vector) as similarity
      FROM "Chunk" c
      JOIN "Document" d ON c.documentId = d.id
      WHERE c.embedding IS NOT NULL
        ${whereClause}
      ORDER BY c.embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `;

    const results = await prisma.$queryRawUnsafe(query);

    return results.map((row: any) => ({
      id: row.id,
      content: row.content,
      similarity: parseFloat(row.similarity),
      documentTitle: row.documentTitle
    }));
  }

  private static async generateAnswer(question: string, context: string): Promise<string> {
    // Mock implementation - in real scenario, this would call GPT-4o-mini
    // For now, return a simple response based on the context
    
    if (context.trim().length === 0) {
      return "I don't have enough information to answer your question.";
    }

    // Simple mock response - in real implementation, use OpenAI API
    return `Based on the provided context, here's what I can tell you about your question: "${question}". The context contains relevant information that should help answer your question. For a complete answer, I would need to process this context using a language model, but for now I'm providing this mock response.`;
  }

  static async getDocumentChunks(documentId: string, userId: string): Promise<{
    document: {
      id: string;
      title: string;
      status: string;
    };
    chunks: Array<{
      id: string;
      content: string;
      index: number;
      tokenCount: number;
    }>;
  }> {
    // Verify document ownership
    const document = await prisma.document.findUnique({
      where: { id: documentId }
    });

    if (!document || document.userId !== userId) {
      throw new Error('Document not found or access denied');
    }

    // Get chunks
    const chunks = await prisma.chunk.findMany({
      where: { documentId },
      orderBy: { index: 'asc' }
    });

    return {
      document: {
        id: document.id,
        title: document.title,
        status: document.status
      },
      chunks: chunks.map(chunk => ({
        id: chunk.id,
        content: chunk.content,
        index: chunk.index,
        tokenCount: chunk.tokenCount || 0
      }))
    };
  }

  static async searchSimilarDocuments(
    queryEmbedding: number[],
    userId: string,
    limit: number = 10
  ): Promise<Array<{
    documentId: string;
    title: string;
    similarity: number;
    chunkCount: number;
  }>> {
    const vectorStr = `[${queryEmbedding.join(',')}]`;

    const results = await prisma.$queryRawUnsafe(`
      SELECT 
        DISTINCT c.documentId,
        d.title,
        MAX(1 - (c.embedding <=> ${vectorStr}::vector)) as similarity,
        COUNT(c.id) as chunkCount
      FROM "Chunk" c
      JOIN "Document" d ON c.documentId = d.id
      WHERE c.embedding IS NOT NULL
        AND d.userId = ${userId}
        AND d.status = 'completed'
      GROUP BY c.documentId, d.title
      HAVING MAX(1 - (c.embedding <=> ${vectorStr}::vector)) > 0.3
      ORDER BY similarity DESC
      LIMIT ${limit}
    `);

    return results.map((row: any) => ({
      documentId: row.documentid,
      title: row.title,
      similarity: parseFloat(row.similarity),
      chunkCount: parseInt(row.chunkcount)
    }));
  }
}
