import { appEvents } from '../lib/events';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

appEvents.on('agent:completed', async (data) => {
  try {
    await prisma.usageLog.create({
      data: {
        userId: data.userId,
        action: 'agent_run',
        resourceId: data.correlationId,
        resourceType: 'agent_session',
        cost: data.totalCostUsd,
        duration: data.durationMs,
        metadata: JSON.stringify({
          correlationId: data.correlationId,
          iterations: data.iterations,
          terminationReason: data.terminationReason,
          toolsUsed: data.toolsUsed,
          confidence: data.confidence,
        }),
      },
    });
  } catch (error) {
    logger.error('Failed to log agent run:', error);
  }
});
