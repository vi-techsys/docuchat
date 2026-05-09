import { Router, Request, Response } from 'express';
import { RAGService } from '../services/rag.service';
import { authenticate } from '../middleware/auths';
import { generateEmbeddingCached } from '../services/embedding.service';

const router = Router();

// Apply authentication to all routes
router.use(authenticate);

// POST /api/v1/rag/query - Query documents using RAG
router.post('/query', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { question, documentId, maxChunks } = req.body;

    if (!question || question.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_QUESTION',
          message: 'Question is required'
        }
      });
    }

    const result = await RAGService.query({
      question: question.trim(),
      userId,
      documentId,
      maxChunks
    });

    return res.status(200).json({
      success: true,
      data: result
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'RAG_QUERY_FAILED',
        message: 'Failed to process RAG query'
      }
    });
  }
});

// GET /api/v1/rag/documents/:documentId/chunks - Get document chunks for RAG
router.get('/documents/:documentId/chunks', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const documentId = req.params.documentId;

    const result = await RAGService.getDocumentChunks(documentId, userId);

    return res.status(200).json({
      success: true,
      data: result
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_CHUNKS_FAILED',
        message: 'Failed to fetch document chunks'
      }
    });
  }
});

// POST /api/v1/rag/search - Search for similar documents
router.post('/search', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { query, limit } = req.body;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_QUERY',
          message: 'Search query is required'
        }
      });
    }

    // Generate embedding for the search query
    const queryEmbedding = await generateEmbeddingCached(query, userId);
    
    const result = await RAGService.searchSimilarDocuments(
      queryEmbedding,
      userId,
      limit || 10
    );

    return res.status(200).json({
      success: true,
      data: {
        query,
        documents: result,
        totalFound: result.length
      }
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'SEARCH_FAILED',
        message: 'Failed to search documents'
      }
    });
  }
});

export default router;
