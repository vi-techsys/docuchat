import pdfParse from 'pdf-parse';

export type SupportedFormat = 'text' | 'pdf' | 'markdown';

export function detectFormat(filename: string): SupportedFormat {
  const ext = filename.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'txt':  return 'text';
    case 'md':   return 'markdown';
    case 'pdf':  return 'pdf';
    default:
      throw new Error(`Unsupported file format: .${ext}`);
  }
}

export async function extractText(
  content: Buffer | string,
  format: SupportedFormat
): Promise<{ text: string; pageCount?: number }> {
  switch (format) {
    case 'text':
      return {
        text: typeof content === 'string'
          ? content
          : content.toString('utf-8'),
      };

    case 'markdown':
      // Strip markdown formatting, keep the text
      const raw = typeof content === 'string'
        ? content
        : content.toString('utf-8');
      return {
        text: stripMarkdown(raw),
      };

    case 'pdf':
      const buffer = typeof content === 'string'
        ? Buffer.from(content, 'base64')
        : content;
      const parsed = await pdfParse(buffer);
      return {
        text: cleanExtractedText(parsed.text),
        pageCount: parsed.numpages,
      };

    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '')     // Headers
    .replace(/\*{1,3}(.*?)\*{1,3}/g, '$1')  // Bold/italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
    .replace(/`{1,3}[^`]*`{1,3}/g, '')  // Code blocks
    .replace(/^[\-*+]\s+/gm, '')  // List markers
    .trim();
}

function cleanExtractedText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')       // Normalize line endings
    .replace(/\n{3,}/g, '\n\n')   // Collapse excessive newlines
    .replace(/\s{3,}/g, ' ')       // Collapse excessive spaces
    .trim();
}
