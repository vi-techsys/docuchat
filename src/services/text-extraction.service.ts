import pdfParse from 'pdf-parse';
import fs from 'fs/promises';
import path from 'path';

export interface ExtractedText {
  text: string;
  metadata: {
    fileName: string;
    fileSize: number;
    mimeType: string;
    pageCount?: number;
    title?: string;
    author?: string;
    subject?: string;
  };
}

export class TextExtractionService {
  private static readonly SUPPORTED_MIME_TYPES = [
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json',
    'text/html'
  ];

  private static readonly MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

  static isSupportedFileType(mimeType: string): boolean {
    return this.SUPPORTED_MIME_TYPES.includes(mimeType);
  }

  static isValidFileSize(fileSize: number): boolean {
    return fileSize <= this.MAX_FILE_SIZE;
  }

  static async extractText(filePath: string, mimeType: string, originalName: string): Promise<ExtractedText> {
    const stats = await fs.stat(filePath);
    
    if (!this.isSupportedFileType(mimeType)) {
      throw new Error(`Unsupported file type: ${mimeType}`);
    }

    if (!this.isValidFileSize(stats.size)) {
      throw new Error(`File size exceeds maximum allowed size of ${this.MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    let text = '';
    let metadata: any = {};

    try {
      switch (mimeType) {
        case 'application/pdf':
          const pdfBuffer = await fs.readFile(filePath);
          const pdfData = await pdfParse(pdfBuffer);
          text = pdfData.text;
          metadata = {
            pageCount: pdfData.numpages,
            title: pdfData.info?.Title,
            author: pdfData.info?.Author,
            subject: pdfData.info?.Subject
          };
          break;

        case 'text/plain':
        case 'text/markdown':
        case 'text/csv':
        case 'application/json':
        case 'text/html':
          text = await fs.readFile(filePath, 'utf-8');
          break;

        default:
          throw new Error(`Unsupported file type: ${mimeType}`);
      }

      return {
        text: text.trim(),
        metadata: {
          fileName: originalName,
          fileSize: stats.size,
          mimeType,
          ...metadata
        }
      };
    } catch (error) {
      throw new Error(`Failed to extract text from file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  static cleanText(text: string): string {
    return text
      .replace(/\s+/g, ' ')  // Replace multiple whitespace with single space
      .replace(/\n\s*\n/g, '\n')  // Replace multiple newlines with single
      .trim();
  }

  static estimateTokenCount(text: string): number {
    // Rough estimation: ~4 characters per token for English text
    return Math.ceil(text.length / 4);
  }
}
