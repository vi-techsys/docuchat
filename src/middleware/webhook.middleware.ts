import { Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { prisma } from '../lib/prisma';

export interface WebhookRequest extends Request {
  rawBody?: Buffer;
}

/**
 * Middleware to verify webhook signatures using HMAC SHA-256
 */
export function verifyWebhookSignature(secret: string, headerName: string = 'x-webhook-signature') {
  return (req: WebhookRequest, res: Response, next: NextFunction) => {
    const signature = req.headers[headerName.toLowerCase()] as string;
    
    if (!signature) {
      console.warn(`🚫 Missing webhook signature header: ${headerName}`);
      return res.status(401).json({
        error: 'Missing webhook signature',
        code: 'MISSING_SIGNATURE'
      });
    }

    if (!req.rawBody) {
      console.error('❌ Raw body not available - ensure express.raw() middleware is used before express.json()');
      return res.status(500).json({
        error: 'Webhook verification failed - raw body not available',
        code: 'NO_RAW_BODY'
      });
    }

    try {
      // Calculate expected signature using HMAC SHA-256
      const expectedSignature = createHmac('sha256', secret)
        .update(req.rawBody)
        .digest('hex');

      // Parse the signature (could be prefixed like 'sha256=...')
      const providedSignature = signature.startsWith('sha256=') 
        ? signature.substring(7) 
        : signature;

      // Use timingSafeEqual to prevent timing attacks
      const isValid = timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(providedSignature, 'hex')
      );

      if (!isValid) {
        console.warn(`🚫 Invalid webhook signature for event`);
        console.warn(`Expected: ${expectedSignature}`);
        console.warn(`Provided: ${providedSignature}`);
        return res.status(401).json({
          error: 'Invalid webhook signature',
          code: 'INVALID_SIGNATURE'
        });
      }

      console.log('✅ Webhook signature verified successfully');
      next();
    } catch (error) {
      console.error('❌ Webhook signature verification error:', error);
      return res.status(500).json({
        error: 'Webhook verification failed',
        code: 'VERIFICATION_ERROR'
      });
    }
  };
}

/**
 * Middleware to check webhook idempotency using WebhookEvent table
 */
export function checkWebhookIdempotency() {
  return async (req: WebhookRequest, res: Response, next: NextFunction) => {
    // Try to extract eventId from various common webhook formats
    const eventId = extractEventId(req.body);
    
    if (!eventId) {
      console.warn('⚠️ No event ID found in webhook payload');
      return next(); // Continue without idempotency check
    }

    try {
      // Check if this event has already been processed
      const existingEvent = await prisma.webhookEvent.findUnique({
        where: { eventId }
      });

      if (existingEvent) {
        console.log(`🔄 Duplicate webhook event detected: ${eventId}`);
        console.log(`Originally processed at: ${existingEvent.processedAt || existingEvent.createdAt}`);
        
        // Return 202 to indicate we received it but won't process again
        return res.status(202).json({
          message: 'Webhook already processed',
          eventId,
          processedAt: existingEvent.processedAt
        });
      }

      // Store the event for idempotency tracking
      await prisma.webhookEvent.create({
        data: {
          eventId,
          eventType: extractEventType(req.body),
          payload: req.body,
          processed: false,
        }
      });

      console.log(`📝 Webhook event stored for processing: ${eventId}`);
      
      // Attach eventId to request for use in handlers
      req.eventId = eventId;
      
      next();
    } catch (error) {
      console.error('❌ Webhook idempotency check error:', error);
      return res.status(500).json({
        error: 'Failed to process webhook',
        code: 'IDEMPOTENCY_ERROR'
      });
    }
  };
}

/**
 * Extract event ID from various webhook payload formats
 */
function extractEventId(payload: any): string | null {
  // Common patterns for event IDs
  const idPaths = [
    'id',                    // Generic
    'event_id',              // Stripe, many others
    'eventId',               // CamelCase
    'data.id',               // Nested data
    'data.object.id',         // Stripe objects
    'event.data.id',         // Some providers
    'webhook_id',            // GitHub
    'action.id',             // Custom format
    'uuid',                  // UUID field
  ];

  for (const path of idPaths) {
    const value = getNestedValue(payload, path);
    if (value && typeof value === 'string') {
      return value;
    }
  }

  return null;
}

/**
 * Extract event type from webhook payload
 */
function extractEventType(payload: any): string {
  // Common patterns for event types
  const typePaths = [
    'type',                   // Generic
    'event',                  // Stripe
    'eventType',              // Explicit
    'event_type',             // Snake case
    'action',                 // Action-based
    'data.type',              // Nested
    'hook.event',             // GitHub
  ];

  for (const path of typePaths) {
    const value = getNestedValue(payload, path);
    if (value && typeof value === 'string') {
      return value;
    }
  }

  return 'unknown';
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : null;
  }, obj);
}

/**
 * Mark webhook event as processed
 */
export async function markWebhookProcessed(eventId: string, success: boolean = true) {
  try {
    await prisma.webhookEvent.update({
      where: { eventId },
      data: {
        processed: true,
        processedAt: new Date(),
        updatedAt: new Date(),
      }
    });

    console.log(`✅ Webhook event ${eventId} marked as ${success ? 'processed' : 'failed'}`);
  } catch (error) {
    console.error(`❌ Failed to mark webhook ${eventId} as processed:`, error);
  }
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      eventId?: string;
    }
  }
}
