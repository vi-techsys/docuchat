import { TextExtractionService } from './text-extraction.service';

export interface ChunkOptions {
  chunkSize: number;
  chunkOverlap: number;
  minChunkSize?: number;
}

export interface Chunk {
  content: string;
  index: number;
  tokenCount: number;
  metadata: {
    startIndex: number;
    endIndex: number;
    originalTextLength: number;
  };
}

export class ChunkingService {
  private static readonly DEFAULT_OPTIONS: ChunkOptions = {
    chunkSize: 1000, // tokens
    chunkOverlap: 200, // tokens
    minChunkSize: 100 // tokens
  };

  static async createChunks(
    text: string,
    options: Partial<ChunkOptions> = {}
  ): Promise<Chunk[]> {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    
    // Clean the text first
    const cleanText = TextExtractionService.cleanText(text);
    
    if (cleanText.length === 0) {
      return [];
    }

    // Estimate token count and split by tokens
    const estimatedTokens = TextExtractionService.estimateTokenCount(cleanText);
    
    if (estimatedTokens <= opts.chunkSize) {
      // Text is small enough for a single chunk
      return [{
        content: cleanText,
        index: 0,
        tokenCount: estimatedTokens,
        metadata: {
          startIndex: 0,
          endIndex: cleanText.length,
          originalTextLength: cleanText.length
        }
      }];
    }

    return this.createTokenBasedChunks(cleanText, opts);
  }

  private static createTokenBasedChunks(text: string, options: ChunkOptions): Chunk[] {
    const chunks: Chunk[] = [];
    const words = text.split(/\s+/);
    let currentChunk = '';
    let currentTokens = 0;
    let chunkIndex = 0;
    let globalCharIndex = 0;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const wordTokens = this.estimateWordTokens(word);
      
      // Check if adding this word would exceed chunk size
      if (currentTokens + wordTokens > options.chunkSize && currentChunk.length > 0) {
        // Save current chunk
        const chunkContent = currentChunk.trim();
        const chunkStartIndex = globalCharIndex - chunkContent.length;
        
        chunks.push({
          content: chunkContent,
          index: chunkIndex,
          tokenCount: currentTokens,
          metadata: {
            startIndex: chunkStartIndex,
            endIndex: globalCharIndex,
            originalTextLength: text.length
          }
        });

        chunkIndex++;
        
        // Start new chunk with overlap
        const overlapWords = this.getOverlapWords(currentChunk, options.chunkOverlap);
        currentChunk = overlapWords + word + ' ';
        currentTokens = this.estimateWordTokens(overlapWords) + wordTokens;
      } else {
        currentChunk += word + ' ';
        currentTokens += wordTokens;
      }
      
      globalCharIndex += word.length + 1; // +1 for space
    }

    // Add the last chunk if it has content
    const finalChunkContent = currentChunk.trim();
    if (finalChunkContent.length > 0) {
      const chunkStartIndex = globalCharIndex - finalChunkContent.length;
      
      chunks.push({
        content: finalChunkContent,
        index: chunkIndex,
        tokenCount: currentTokens,
        metadata: {
          startIndex: chunkStartIndex,
          endIndex: globalCharIndex,
          originalTextLength: text.length
        }
      });
    }

    // Filter out chunks that are too small
    const minChunkSize = options.minChunkSize || this.DEFAULT_OPTIONS.minChunkSize!;
    return chunks.filter(chunk => chunk.tokenCount >= minChunkSize);
  }

  private static getOverlapWords(currentChunk: string, overlapTokens: number): string {
    if (overlapTokens <= 0) return '';
    
    const words = currentChunk.trim().split(/\s+/);
    let overlapWordCount = 0;
    let overlapChars = 0;
    
    // Estimate how many words we need for the overlap
    for (let i = words.length - 1; i >= 0; i--) {
      const wordTokens = this.estimateWordTokens(words[i]);
      if (overlapChars + wordTokens <= overlapTokens) {
        overlapChars += wordTokens;
        overlapWordCount++;
      } else {
        break;
      }
    }
    
    return words.slice(-overlapWordCount).join(' ') + ' ';
  }

  private static estimateWordTokens(word: string): number {
    // Rough estimation: ~4 characters per token
    return Math.max(1, Math.ceil(word.length / 4));
  }

  static getChunkingStats(chunks: Chunk[]): {
    totalChunks: number;
    totalTokens: number;
    averageTokensPerChunk: number;
    minTokensPerChunk: number;
    maxTokensPerChunk: number;
  } {
    if (chunks.length === 0) {
      return {
        totalChunks: 0,
        totalTokens: 0,
        averageTokensPerChunk: 0,
        minTokensPerChunk: 0,
        maxTokensPerChunk: 0
      };
    }

    const tokenCounts = chunks.map(chunk => chunk.tokenCount);
    const totalTokens = tokenCounts.reduce((sum, count) => sum + count, 0);

    return {
      totalChunks: chunks.length,
      totalTokens,
      averageTokensPerChunk: Math.round(totalTokens / chunks.length),
      minTokensPerChunk: Math.min(...tokenCounts),
      maxTokensPerChunk: Math.max(...tokenCounts)
    };
  }
}
