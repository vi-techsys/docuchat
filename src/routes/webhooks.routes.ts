import { Router } from 'express';
import type { Request, Response } from 'express';
import { verifyWebhookSignature, checkWebhookIdempotency, markWebhookProcessed } from '../middleware/webhook.middleware';

const router = Router();

/**
 * Generic webhook handler - returns 202 quickly, then processes async
 */
router.post('/', 
  // First, capture raw body for signature verification
  (req, res, next) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      (req as any).rawBody = Buffer.concat(chunks);
      next();
    });
  },
  // Verify webhook signature
  verifyWebhookSignature(process.env.WEBHOOK_SECRET || 'default-webhook-secret'),
  // Check idempotency
  checkWebhookIdempotency(),
  // Main handler
  async (req: Request, res: Response) => {
    const eventId = (req as any).eventId;
    
    try {
      // Return 202 immediately to acknowledge receipt
      res.status(202).json({
        message: 'Webhook received and queued for processing',
        eventId,
        receivedAt: new Date().toISOString()
      });

      // Process webhook asynchronously
      processWebhookAsync(req.body, eventId)
        .then(() => {
          console.log(`✅ Webhook ${eventId} processed successfully`);
        })
        .catch((error) => {
          console.error(`❌ Webhook ${eventId} processing failed:`, error);
          // Mark as failed but don't send response (already sent)
          markWebhookProcessed(eventId!, false);
        });

    } catch (error) {
      console.error(`❌ Webhook handler error:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Internal server error',
          code: 'HANDLER_ERROR'
        });
      }
    }
  }
);

/**
 * Async webhook processing function
 */
async function processWebhookAsync(payload: any, eventId: string) {
  console.log(`🔄 Processing webhook ${eventId} asynchronously...`);
  
  try {
    // Extract event type and data
    const eventType = extractEventType(payload);
    const eventData = extractEventData(payload);
    
    console.log(`📋 Event type: ${eventType}`);
    console.log(`📦 Event data:`, JSON.stringify(eventData, null, 2));

    // Route to appropriate handler based on event type
    switch (eventType) {
      case 'payment.succeeded':
      case 'invoice.payment_succeeded':
        await handlePaymentSuccess(eventData);
        break;
        
      case 'payment.failed':
      case 'invoice.payment_failed':
        await handlePaymentFailure(eventData);
        break;
        
      case 'customer.created':
        await handleCustomerCreated(eventData);
        break;
        
      case 'customer.updated':
        await handleCustomerUpdated(eventData);
        break;
        
      case 'subscription.created':
        await handleSubscriptionCreated(eventData);
        break;
        
      case 'subscription.canceled':
        await handleSubscriptionCanceled(eventData);
        break;
        
      case 'user.updated':
        await handleUserUpdated(eventData);
        break;
        
      case 'document.processed':
        await handleDocumentProcessed(eventData);
        break;
        
      default:
        console.log(`ℹ️ No specific handler for event type: ${eventType}`);
        await handleGenericEvent(eventType, eventData);
        break;
    }

    // Mark as processed only after successful processing
    await markWebhookProcessed(eventId, true);
    
  } catch (error) {
    console.error(`❌ Async webhook processing failed for ${eventId}:`, error);
    await markWebhookProcessed(eventId, false);
    throw error;
  }
}

/**
 * Event type extractors
 */
function extractEventType(payload: any): string {
  return payload.type || payload.event || payload.event_type || 'unknown';
}

function extractEventData(payload: any): any {
  // Common patterns for event data
  return payload.data || payload.object || payload;
}

/**
 * Event handlers
 */
async function handlePaymentSuccess(data: any) {
  console.log('💰 Processing payment success:', data.id);
  // Add your payment success logic here
  // Example: Update user subscription, send confirmation email, etc.
}

async function handlePaymentFailure(data: any) {
  console.log('❌ Processing payment failure:', data.id);
  // Add your payment failure logic here
  // Example: Notify user, update billing status, etc.
}

async function handleCustomerCreated(data: any) {
  console.log('👤 Processing customer created:', data.id);
  // Add your customer creation logic here
}

async function handleCustomerUpdated(data: any) {
  console.log('👤 Processing customer updated:', data.id);
  // Add your customer update logic here
}

async function handleSubscriptionCreated(data: any) {
  console.log('📋 Processing subscription created:', data.id);
  // Add your subscription creation logic here
}

async function handleSubscriptionCanceled(data: any) {
  console.log('🚫 Processing subscription canceled:', data.id);
  // Add your subscription cancellation logic here
}

async function handleUserUpdated(data: any) {
  console.log('👤 Processing user updated:', data.id);
  // Add your user update logic here
}

async function handleDocumentProcessed(data: any) {
  console.log('📄 Processing document processed:', data.documentId);
  // Add your document processing logic here
  // Example: Update document status, notify user, etc.
}

async function handleGenericEvent(eventType: string, data: any) {
  console.log(`🔄 Processing generic event ${eventType}:`, data);
  // Add your generic event handling logic here
  // Example: Log event, send to analytics, etc.
}

export default router;
