import { SearchResult } from './search.service';

export interface AssembledContext {
  chunks: SearchResult[];
  contextText: string;
  totalTokens: number;
  citations: Citation[];
}

export interface Citation {
  index: number;         // [1], [2], etc.
  chunkId: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  score: number;
}

export interface ContextAssemblyOptions {
  tokenBudget?: number;
  maxChunks?: number;
  minScore?: number;
  includeMetadata?: boolean;
  enableDeduplication?: boolean;
  redundancyChunkProximity?: number;
}

const DEFAULT_CONTEXT_TOKEN_BUDGET = 3500;
const DEFAULT_MAX_CHUNKS = 8;
const DEFAULT_MIN_SCORE = 0.3;
const DEFAULT_REDUNDANCY_PROXIMITY = 1; // Adjacent chunks

function isRedundant(
  candidate: SearchResult,
  selected: SearchResult[],
  proximity: number = DEFAULT_REDUNDANCY_PROXIMITY
): boolean {
  return selected.some(s =>
    s.documentId === candidate.documentId &&
    Math.abs(s.chunkIndex - candidate.chunkIndex) <= proximity
  );
}

export function assembleContext(
  searchResults: SearchResult[],
  options: ContextAssemblyOptions = {}
): AssembledContext {
  const {
    tokenBudget = DEFAULT_CONTEXT_TOKEN_BUDGET,
    maxChunks = DEFAULT_MAX_CHUNKS,
    minScore = DEFAULT_MIN_SCORE,
    includeMetadata = true,
    enableDeduplication = true,
    redundancyChunkProximity = DEFAULT_REDUNDANCY_PROXIMITY
  } = options;

  // Filter by minimum score first
  const filteredResults = searchResults.filter(result => result.score >= minScore);
  
  // Take top results (already sorted by score descending from search)
  const topResults = filteredResults.slice(0, maxChunks);
  
  const selected: SearchResult[] = [];
  let totalTokens = 0;

  // Select chunks that fit within the token budget
  for (const result of topResults) {
    // Skip redundant chunks if deduplication is enabled
    if (enableDeduplication && isRedundant(result, selected, redundancyChunkProximity)) {
      continue;
    }
    
    if (totalTokens + result.tokenCount > tokenBudget) {
      break; // Budget exhausted
    }
    selected.push(result);
    totalTokens += result.tokenCount;
  }

  // Build citations
  const citations: Citation[] = selected.map((chunk, i) => ({
    index: i + 1,
    chunkId: chunk.chunkId,
    documentId: chunk.documentId,
    documentTitle: chunk.documentTitle,
    chunkIndex: chunk.chunkIndex,
    score: chunk.score,
  }));

  // Build the context text block
  const contextText = selected
    .map((chunk, i) => {
      const citation = `[Source ${i + 1}]`;
      const metadata = includeMetadata 
        ? `${citation}: "${chunk.documentTitle}", Section ${chunk.chunkIndex + 1} (Score: ${(chunk.score * 100).toFixed(1)}%)`
        : citation;
      
      return `${metadata}\n${chunk.content}`;
    })
    .join('\n\n---\n\n');

  return {
    chunks: selected,
    contextText,
    totalTokens,
    citations,
  };
}

export function optimizeContextForTokenBudget(
  searchResults: SearchResult[],
  targetTokenCount: number
): AssembledContext {
  // If we're already under budget, use standard assembly
  const totalTokens = searchResults.reduce((sum, result) => sum + result.tokenCount, 0);
  if (totalTokens <= targetTokenCount) {
    return assembleContext(searchResults, { tokenBudget: targetTokenCount });
  }

  // For over-budget cases, implement a more sophisticated selection
  const selected: SearchResult[] = [];
  let currentTokens = 0;
  
  // Sort by score per token ratio for better efficiency
  const sortedByRatio = searchResults
    .map(result => ({
      ...result,
      scorePerToken: result.score / result.tokenCount
    }))
    .sort((a, b) => b.scorePerToken - a.scorePerToken);

  for (const result of sortedByRatio) {
    if (currentTokens + result.tokenCount > targetTokenCount) {
      // Try to find a smaller chunk that fits
      const smallerChunk = searchResults
        .filter(r => r.tokenCount <= (targetTokenCount - currentTokens))
        .sort((a, b) => b.score - a.score)[0];
      
      if (smallerChunk && !selected.find(s => s.chunkId === smallerChunk.chunkId)) {
        selected.push(smallerChunk);
        currentTokens += smallerChunk.tokenCount;
      }
      break;
    }
    selected.push(result);
    currentTokens += result.tokenCount;
  }

  // Re-sort selected by original score for proper ordering
  selected.sort((a, b) => b.score - a.score);

  // Build citations and context
  const citations: Citation[] = selected.map((chunk, i) => ({
    index: i + 1,
    chunkId: chunk.chunkId,
    documentId: chunk.documentId,
    documentTitle: chunk.documentTitle,
    chunkIndex: chunk.chunkIndex,
    score: chunk.score,
  }));

  const contextText = selected
    .map((chunk, i) => 
      `[Source ${i + 1}: "${chunk.documentTitle}", Section ${chunk.chunkIndex + 1}]\n${chunk.content}` 
    )
    .join('\n\n---\n\n');

  return {
    chunks: selected,
    contextText,
    totalTokens: currentTokens,
    citations,
  };
}

export function createContextSummary(context: AssembledContext): {
  summary: string;
  documentBreakdown: Array<{
    documentId: string;
    documentTitle: string;
    chunkCount: number;
    totalTokens: number;
    averageScore: number;
  }>;
} {
  // Group chunks by document
  const documentGroups = context.chunks.reduce((groups, chunk) => {
    if (!groups[chunk.documentId]) {
      groups[chunk.documentId] = {
        documentId: chunk.documentId,
        documentTitle: chunk.documentTitle,
        chunks: [],
        totalTokens: 0,
        totalScore: 0
      };
    }
    groups[chunk.documentId].chunks.push(chunk);
    groups[chunk.documentId].totalTokens += chunk.tokenCount;
    groups[chunk.documentId].totalScore += chunk.score;
    return groups;
  }, {} as Record<string, any>);

  const documentBreakdown = Object.values(documentGroups).map((group: any) => ({
    documentId: group.documentId,
    documentTitle: group.documentTitle,
    chunkCount: group.chunks.length,
    totalTokens: group.totalTokens,
    averageScore: group.totalScore / group.chunks.length
  }));

  const summary = `Assembled context with ${context.chunks.length} chunks from ${documentBreakdown.length} documents. Total tokens: ${context.totalTokens}. Average similarity: ${(context.chunks.reduce((sum, c) => sum + c.score, 0) / context.chunks.length * 100).toFixed(1)}%.`;

  return { summary, documentBreakdown };
}

export function validateContext(context: AssembledContext): {
  isValid: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Check if context is empty
  if (context.chunks.length === 0) {
    errors.push('No chunks selected for context');
    return { isValid: false, warnings, errors };
  }

  // Check token budget
  if (context.totalTokens > DEFAULT_CONTEXT_TOKEN_BUDGET) {
    warnings.push(`Context exceeds default token budget: ${context.totalTokens} > ${DEFAULT_CONTEXT_TOKEN_BUDGET}`);
  }

  // Check minimum chunks
  if (context.chunks.length < 2) {
    warnings.push('Context contains fewer than 2 chunks, may be insufficient for comprehensive answer');
  }

  // Check average score
  const avgScore = context.chunks.reduce((sum, c) => sum + c.score, 0) / context.chunks.length;
  if (avgScore < 0.4) {
    warnings.push(`Low average similarity score: ${(avgScore * 100).toFixed(1)}%`);
  }

  // Check for duplicate documents
  const uniqueDocs = new Set(context.chunks.map(c => c.documentId));
  if (uniqueDocs.size === 1 && context.chunks.length > 3) {
    warnings.push('All chunks from same document, consider broader search for more diverse context');
  }

  // Check citation consistency
  if (context.citations.length !== context.chunks.length) {
    errors.push('Citation count does not match chunk count');
  }

  return {
    isValid: errors.length === 0,
    warnings,
    errors
  };
}
