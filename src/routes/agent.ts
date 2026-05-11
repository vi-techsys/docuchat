/// <reference path="../types/express.d.ts">
import { Router } from "express"
import type { Request, Response } from "express"
import { authenticate } from "../middleware/auths"
import { runAgent } from "../agents/executor"

const router = Router();
router.use(authenticate);

router.post('/research',
  async (req, res, next) => {
    try {
      const startTime = Date.now();
      const result = await runAgent({
        question: req.body.question,
        userId: req.user!.id,
        correlationId: (req as any).correlationId,
      });

      res.json({
        success: true,
        data: {
          answer: result.answer,
          sources: result.sources,
          confidence: result.confidence,
          metadata: {
            iterations: result.iterations,
            costUsd: result.totalCostUsd,
            terminationReason: result.terminationReason,
            toolsUsed: result.trace
              .filter(s => s.tool)
              .map(s => s.tool),
            confidence: result.confidence,
            durationMs: Date.now() - startTime,
          },
        },
      });
    } catch (error) { next(error); }
  }
);

export default router;
