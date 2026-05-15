import { mcpComplete, MCPRequest } from './mcp.service';
import { customLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { cacheGet, cacheSet, CACHE_TTL } from '../lib/cache';
import { emitEmbeddingGenerated } from '../events/ai.events';
import crypto from 'crypto';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 100; // Stay well under OpenAI's 2048 limit
const COST_PER_1M_TOKENS = 0.02; // $0.02 per 1M tokens for text-embedding-3-small

function contentHash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export async function generateEmbedding(
  text: string,
  userId: string = 'system',
  correlationId: string = 'unknown'
): Promise<number[]> {
  const startTime = Date.now();

  const mcpRequest: MCPRequest = {
    taskType: 'embedding',
    messages: [{ role: 'user', content: text }],
    userId,
    correlationId,
  };

  const response = await mcpComplete(mcpRequest);

  const embedding = JSON.parse(response.content);
  const duration = Date.now() - startTime;

  customLogger.info(`Embedding generated: model=${response.model}, promptVersion=${response.promptVersion}, inputLength=${text.length}, dimensions=${embedding.length}, durationMs=${duration}, tokensUsed=${response.tokensUsed.total}, costUsd=${response.costUsd.toFixed(6)}`);

  return embedding;
}

export async function generateEmbeddingCached(
  text: string,
  userId: string = 'system',
  documentId?: string,
  correlationId: string = 'unknown'
): Promise<number[]> {
  const hash = contentHash(text);
  const cacheKey = `embed:${hash}`;

  // Check cache
  const cached = await cacheGet(cacheKey);
  if (cached) {
    customLogger.info(`Embedding cache hit - hash: ${hash.substring(0, 12)}`);
    
    // Emit cached event for tracking
    if (userId) {
      emitEmbeddingGenerated({
        userId,
        documentId,
        model: EMBEDDING_MODEL,
        tokensUsed: 0,
        costUsd: 0,
        cached: true,
      });
    }
    
    return cached;
  }

  // Cache miss — generate
  const mcpRequest: MCPRequest = {
    taskType: 'embedding',
    messages: [{ role: 'user', content: text }],
    userId,
    correlationId,
  };

  const response = await mcpComplete(mcpRequest);

  const embedding = JSON.parse(response.content);
  const tokensUsed = response.tokensUsed.total;
  const costUsd = response.costUsd;

  // Emit event for cost tracking
  if (userId) {
    emitEmbeddingGenerated({
      userId,
      documentId,
      model: response.model,
      tokensUsed,
      costUsd,
      cached: false,
    });
  }

  // Cache for 7 days (embeddings don't change for the same input)
  await cacheSet(cacheKey, embedding, CACHE_TTL.EMBEDDING);

  customLogger.info(`Embedding cached: ${hash.substring(0, 12)}, model=${response.model}, costUsd=${costUsd.toFixed(6)}`);
  return embedding;
}

export async function generateEmbeddings(
  texts: string[],
  userId: string = 'system',
  correlationId: string = 'unknown'
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    // Process each text individually through MCP
    for (const text of batch) {
      const mcpRequest: MCPRequest = {
        taskType: 'embedding',
        messages: [{ role: 'user', content: text }],
        userId,
        correlationId: `${correlationId}-${i}`,
      };

      const response = await mcpComplete(mcpRequest);
      const embedding = JSON.parse(response.content);
      allEmbeddings.push(embedding);
    }

    customLogger.info(`Embedding batch processed - batchIndex: ${Math.floor(i / BATCH_SIZE)}, batchSize: ${batch.length}, totalTexts: ${texts.length}`);
  }

  return allEmbeddings;
}

export async function generateEmbeddingsBatchCached(
  texts: string[],
  userId: string = 'system',
  documentId?: string,
  correlationId: string = 'unknown'
): Promise<number[][]> {
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  const uncached: { index: number; text: string }[] = [];

  // 1. Check cache for each text
  for (let i = 0; i < texts.length; i++) {
    const hash = contentHash(texts[i]);
    const cached = await cacheGet(`embed:${hash}`);
    if (cached) {
      results[i] = cached;
    } else {
      uncached.push({ index: i, text: texts[i] });
    }
  }

  customLogger.info(`Embedding batch cache check - total: ${texts.length}, cacheHits: ${texts.length - uncached.length}, cacheMisses: ${uncached.length}`);

  // 2. Generate embeddings only for uncached texts
  if (uncached.length > 0) {
    let totalTokensUsed = 0;
    let totalCostUsd = 0;

    // Process each uncached text through MCP
    for (let i = 0; i < uncached.length; i++) {
      const mcpRequest: MCPRequest = {
        taskType: 'embedding',
        messages: [{ role: 'user', content: uncached[i].text }],
        userId,
        correlationId: `${correlationId}-${i}`,
      };

      const response = await mcpComplete(mcpRequest);
      const embedding = JSON.parse(response.content);
      
      const hash = contentHash(uncached[i].text);
      await cacheSet(`embed:${hash}`, embedding, CACHE_TTL.EMBEDDING);
      results[uncached[i].index] = embedding;

      totalTokensUsed += response.tokensUsed.total;
      totalCostUsd += response.costUsd;
    }

    // Emit event for cost tracking
    if (userId) {
      emitEmbeddingGenerated({
        userId,
        documentId,
        model: 'text-embedding-3-small',
        tokensUsed: totalTokensUsed,
        costUsd: totalCostUsd,
        cached: false,
      });
    }
  }

  return results as number[][];
}

export async function storeChunkEmbedding(
  chunkId: string,
  embedding: number[]
): Promise<void> {
  const vectorStr = `[${embedding.join(',')}]`;

  await prisma.$executeRaw`
    UPDATE "Chunk"
    SET embedding = ${vectorStr}::vector
    WHERE id = ${chunkId}
  `;
}

export async function storeChunkEmbeddingsBatch(
  chunks: { id: string; embedding: number[] }[]
): Promise<void> {
  // Use a transaction for atomicity
  await prisma.$transaction(
    chunks.map(chunk => {
      const vectorStr = `[${chunk.embedding.join(',')}]`;
      return prisma.$executeRaw`
        UPDATE "Chunk"
        SET embedding = ${vectorStr}::vector
        WHERE id = ${chunk.id}
      `;
    })
  );
}

export async function generateAndStoreEmbeddings(
  chunks: { id: string; content: string }[],
  userId: string = 'system',
  documentId?: string,
  correlationId: string = 'unknown'
): Promise<{ cost: number; tokensUsed: number }> {
  // Extract texts for batch processing
  const texts = chunks.map(chunk => chunk.content);
  
  // Generate embeddings in batch with caching
  const embeddings = await generateEmbeddingsBatchCached(texts, userId, documentId, correlationId);
  
  // Prepare data for storage
  const chunkEmbeddings = chunks.map((chunk, index) => ({
    id: chunk.id,
    embedding: embeddings[index]
  }));
  
  // Store embeddings in batch
  await storeChunkEmbeddingsBatch(chunkEmbeddings);
  
  // Calculate total tokens and cost
  const totalTokens = chunks.reduce((sum, chunk) => sum + Math.ceil(chunk.content.length / 4), 0);
  const totalCost = (totalTokens / 1_000_000) * COST_PER_1M_TOKENS;
  
  customLogger.info(`Embeddings generated and stored - chunkCount: ${chunks.length}, model: ${EMBEDDING_MODEL}, dimensions: ${EMBEDDING_DIMENSIONS}, cost: $${totalCost.toFixed(6)}`);
  
  return { cost: totalCost, tokensUsed: totalTokens };
}
