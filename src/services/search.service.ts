import { prisma } from '../lib/prisma';
import { generateEmbeddingCached } from './embedding.service';
import { customLogger } from '../lib/logger';

export interface SearchResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  chunkIndex: number;
  score: number;       // Cosine similarity (0 to 1, higher = more similar)
  tokenCount: number;
}

export async function semanticSearch(options: {
  query: string;
  userId: string;
  documentId?: string;  // Optional: search within a specific document
  topK?: number;
  minScore?: number;
  correlationId?: string;
}): Promise<SearchResult[]> {
  const {
    query,
    userId,
    documentId,
    topK = 10,
    minScore = 0.3,
    correlationId = 'unknown'
  } = options;

  const startTime = Date.now();

  try {
    // Step 1: Embed the query
    const queryEmbedding = await generateEmbeddingCached(query, userId);
    const vectorStr = `[${queryEmbedding.join(',')}]`;

    // Step 3: Search pgvector with ownership filter
    let results;
    
    if (documentId) {
      // Search within specific document
      results = await prisma.$queryRaw`
        SELECT
          c.id AS "chunkId",
          c."documentId",
          d.title AS "documentTitle",
          c.content,
          c.index AS "chunkIndex",
          c."tokenCount",
          1 - (c.embedding <=> ${vectorStr}::vector) AS score
        FROM "Chunk" c
        JOIN documents d ON d.id = c."documentId"
        WHERE d."userId" = ${userId}
          AND d."deletedAt" IS NULL
          AND d.status = 'completed'
          AND c.embedding IS NOT NULL
          AND d.id = ${documentId}
        ORDER BY c.embedding <=> ${vectorStr}::vector
        LIMIT ${topK}
      `;
    } else {
      // Search across all documents
      results = await prisma.$queryRaw`
        SELECT
          c.id AS "chunkId",
          c."documentId",
          d.title AS "documentTitle",
          c.content,
          c.index AS "chunkIndex",
          c."tokenCount",
          1 - (c.embedding <=> ${vectorStr}::vector) AS score
        FROM "Chunk" c
        JOIN documents d ON d.id = c."documentId"
        WHERE d."userId" = ${userId}
          AND d."deletedAt" IS NULL
          AND d.status = 'completed'
          AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> ${vectorStr}::vector
        LIMIT ${topK}
      `;
    }

    // Step 4: Filter by minimum score
    const filtered = (results as any[]).filter((r: any) => r.score >= minScore);

    const duration = Date.now() - startTime;
    customLogger.info('Semantic search completed', {
      query: query.substring(0, 100),
      totalResults: (results as any[]).length,
      filteredResults: filtered.length,
      topScore: filtered[0]?.score?.toFixed(4),
      durationMs: duration,
      correlationId,
      userId,
      documentId
    });

    return filtered;

  } catch (error) {
    const duration = Date.now() - startTime;
    customLogger.error('Semantic search failed', {
      query: query.substring(0, 100),
      error: error instanceof Error ? error.message : 'Unknown error',
      durationMs: duration,
      correlationId,
      userId
    });
    throw error;
  }
}

export async function getDocumentStatistics(documentId: string, userId: string): Promise<{
  totalChunks: number;
  chunksWithEmbeddings: number;
  averageTokenCount: number;
  status: string;
}> {
  const stats = await prisma.$queryRaw<any[]>`
    SELECT 
      COUNT(c.id) as "totalChunks",
      COUNT(c.embedding) as "chunksWithEmbeddings",
      AVG(c."tokenCount") as "averageTokenCount",
      d.status
    FROM documents d
    LEFT JOIN "Chunk" c ON d.id = c."documentId"
    WHERE d.id = '${documentId}'
      AND d."userId" = '${userId}'
    GROUP BY d.status
  `;

  const result = stats[0];
  return {
    totalChunks: parseInt(result.totalChunks) || 0,
    chunksWithEmbeddings: parseInt(result.chunksWithEmbeddings) || 0,
    averageTokenCount: parseFloat(result.averageTokenCount) || 0,
    status: result.status || 'unknown'
  };
}

export async function searchAcrossAllDocuments(options: {
  query: string;
  userId: string;
  topK?: number;
  minScore?: number;
  correlationId?: string;
}): Promise<Array<SearchResult & { documentScore: number }>> {
  const {
    query,
    userId,
    topK = 10,
    minScore = 0.3,
    correlationId = 'unknown'
  } = options;

  const startTime = Date.now();

  try {
    const queryEmbedding = await generateEmbeddingCached(query, userId);
    const vectorStr = `[${queryEmbedding.join(',')}]`;

    const results = await prisma.$queryRaw`
      SELECT DISTINCT ON (d.id)
        c.id AS "chunkId",
        c."documentId",
        d.title AS "documentTitle",
        c.content,
        c.index AS "chunkIndex",
        c."tokenCount",
        1 - (c.embedding <=> ${vectorStr}::vector) AS score,
        MAX(1 - (c.embedding <=> ${vectorStr}::vector)) OVER (PARTITION BY d.id) AS "documentScore"
      FROM "Chunk" c
      JOIN documents d ON d.id = c."documentId"
      WHERE d."userId" = ${userId}
        AND d."deletedAt" IS NULL
        AND d.status = 'completed'
        AND c.embedding IS NOT NULL
      ORDER BY d.id, c.embedding <=> ${vectorStr}::vector
      LIMIT ${topK}
    `;

    const filtered = (results as any[]).filter((r: any) => r.score >= minScore);

    const duration = Date.now() - startTime;
    customLogger.info('Cross-document search completed', {
      query: query.substring(0, 100),
      totalResults: (results as any[]).length,
      filteredResults: filtered.length,
      topScore: filtered[0]?.score?.toFixed(4),
      durationMs: duration,
      correlationId,
      userId
    });

    return filtered;

  } catch (error) {
    const duration = Date.now() - startTime;
    customLogger.error('Cross-document search failed', {
      query: query.substring(0, 100),
      error: error instanceof Error ? error.message : 'Unknown error',
      durationMs: duration,
      correlationId,
      userId
    });
    throw error;
  }
}
