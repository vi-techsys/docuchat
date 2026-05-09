import { appEvents } from '../lib/events';
import { prisma } from '../lib/prisma';
import { customLogger as logger } from '../lib/logger';

// Track real OpenAI costs per document
const documentCosts = new Map<string, number>();

// Listen to AI embedding events to track real costs
appEvents.on('ai:embedding-generated', (event: any) => {
  if (event.documentId) {
    const currentCost = documentCosts.get(event.documentId) || 0;
    documentCosts.set(event.documentId, currentCost + event.costUsd);
    
    logger.info('Cost tracked for document', {
      documentId: event.documentId,
      tokensUsed: event.tokensUsed,
      costUsd: event.costUsd,
      cumulativeCost: currentCost + event.costUsd,
      cached: event.cached
    });
  }
});

appEvents.on('doc:processed', async (data: any) => {
  try {
    // Get the accumulated real cost for this document
    const totalCost = documentCosts.get(data.documentId) || 0;
    
    // Clean up the cost tracking
    documentCosts.delete(data.documentId);

    await prisma.usageLog.create({
      data: {
        userId: data.userId,
        action: 'document_ingested',
        resourceType: 'document',
        resourceId: data.documentId,
        metadata: JSON.stringify({
          chunkCount: data.chunkCount,
          format: data.format,
          pageCount: data.pageCount,
        }),
        duration: data.durationMs,
        cost: totalCost > 0 ? totalCost : null,
      },
    });

    logger.info('Ingestion logged with real OpenAI costs', {
      documentId: data.documentId,
      chunkCount: data.chunkCount,
      correlationId: data.correlationId,
      totalCost: totalCost > 0 ? `$${totalCost.toFixed(6)}` : 'No cost'
    });
  } catch (error) {
    logger.error('Failed to log ingestion:', error);
  }
});
