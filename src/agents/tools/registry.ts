import { ToolDefinition } from './index';
import { searchDocumentsTool } from './searchDocuments';
import { finalAnswerTool } from './finalAnswer';
import { z } from 'zod';

// Add more tools here as you build them
export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  search_documents: searchDocumentsTool,
  // get_document_summary: documentSummaryTool,
  // analyze_chunks: analyzeChunksTool,
  final_answer: finalAnswerTool,
};

// Convert to OpenAI function calling format
export function getToolSchemas() {
  return Object.values(TOOL_REGISTRY)
    .filter(t => t.name !== 'final_answer')  // final_answer handled separately
    .map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.parameters),
      },
    }));
}

// Convert Zod schema to OpenAI JSON Schema format
function zodToJsonSchema(schema: z.ZodType) {
  return {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query describing what to look for',
        minLength: 3,
        maxLength: 500
      },
      documentId: {
        type: 'string',
        description: 'Optional: search within a specific document',
        format: 'uuid'
      },
      topK: {
        type: 'number',
        description: 'Number of results to return',
        minimum: 1,
        maximum: 10,
        default: 5
      }
    },
    required: ['query']
  };
}
