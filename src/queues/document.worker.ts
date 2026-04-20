import { Worker, Job } from 'bullmq';
import { redisConnection } from './connection';
import { prisma } from '../lib/prisma';
import { documentQueue } from './document.queue';
import { deadLetterQueue } from './dead-letter.queue';

export interface DocumentProcessingJob {
  documentId: string;
  userId: string;
}

// Create the worker with concurrency control
export const documentWorker = new Worker<DocumentProcessingJob>(
  'document-processing',
  async (job: Job<DocumentProcessingJob>) => {
    const { documentId, userId } = job.data;
    
    console.log(`🔄 Processing document ${documentId} (job ID: ${job.id})`);
    
    try {
      // Step 1: Fetch the document
      await job.updateProgress(10);
      console.log(`📖 Fetching document ${documentId}`);
      
      const document = await prisma.document.findFirst({
        where: { id: documentId, userId, deletedAt: null }
      });
      
      if (!document) {
        throw new Error(`Document ${documentId} not found`);
      }
      
      // Step 2: Update status to processing
      await job.updateProgress(25);
      console.log(`⚙️ Updating document status to processing`);
      
      await prisma.document.update({
        where: { id: documentId },
        data: { status: 'processing' }
      });
      
      // Step 3: Delete existing chunks (idempotent operation)
      await job.updateProgress(40);
      console.log(`🗑️ Deleting existing chunks for document ${documentId}`);
      
      await prisma.chunk.deleteMany({
        where: { documentId }
      });
      
      // Step 4: Chunk the document content
      await job.updateProgress(60);
      console.log(`✂️ Chunking document content`);
      
      const chunks = chunkDocument(document.content);
      console.log(`📦 Created ${chunks.length} chunks`);
      
      // Step 5: Store chunks in database using transaction
      await job.updateProgress(80);
      console.log(`💾 Storing chunks in database`);
      
      await prisma.$transaction(async (tx) => {
        // Create all chunks
        for (let i = 0; i < chunks.length; i++) {
          await tx.chunk.create({
            data: {
              documentId,
              content: chunks[i],
              order: i
            }
          });
        }
        
        // Update document status to ready
        await tx.document.update({
          where: { id: documentId },
          data: { status: 'ready' }
        });
      });
      
      // Step 6: Complete processing
      await job.updateProgress(100);
      console.log(`✅ Document ${documentId} processed successfully`);
      
      return {
        success: true,
        documentId,
        chunksCreated: chunks.length,
        processedAt: new Date()
      };
      
    } catch (error) {
      console.error(`❌ Error processing document ${documentId}:`, error);
      
      // Only mark as failed on the last attempt
      if (job.attemptsMade >= job.opts.attempts! - 1) {
        console.log(`🚨 Marking document ${documentId} as failed after ${job.attemptsMade} attempts`);
        
        try {
          await prisma.document.update({
            where: { id: documentId },
            data: { status: 'error' }
          });
        } catch (updateError) {
          console.error(`Failed to update document status to error:`, updateError);
        }
      }
      
      throw error; // Re-throw to trigger retry
    }
  },
  {
    connection: redisConnection,
    concurrency: 3, // Process 3 documents concurrently
  }
);

// Helper function to chunk document content
function chunkDocument(content: string, chunkSize: number = 1000): string[] {
  const chunks: string[] = [];
  
  // Simple chunking by character count with word boundary awareness
  let currentChunk = '';
  const words = content.split(' ');
  
  for (const word of words) {
    const testChunk = currentChunk ? `${currentChunk} ${word}` : word;
    
    if (testChunk.length <= chunkSize) {
      currentChunk = testChunk;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = word;
      } else {
        // Word is longer than chunk size, split it
        for (let i = 0; i < word.length; i += chunkSize) {
          chunks.push(word.substring(i, i + chunkSize));
        }
      }
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks.length > 0 ? chunks : ['']; // Ensure at least one chunk
}

// Worker event listeners
documentWorker.on('completed', (job: Job<DocumentProcessingJob>, result: any) => {
  const jobId = typeof job.id === 'string' ? job.id : 'unknown';
  console.log(`✅ Job ${jobId} completed for document ${job.data.documentId}`);
  console.log(`📊 Result:`, result);
});

documentWorker.on('failed', (job: Job<DocumentProcessingJob> | undefined, err: Error) => {
  if (job) {
    const jobId = typeof job.id === 'string' ? job.id : 'unknown';
    console.error(`❌ Job ${jobId} failed for document ${job.data.documentId}:`, err.message);
    
    // Move to dead letter queue if this was the final attempt
    if (job.attemptsMade >= job.opts.attempts! - 1) {
      console.log(`📦 Moving job ${jobId} to dead letter queue`);
      deadLetterQueue.add('failed-document-processing', {
        originalJobData: job.data,
        error: err.message,
        attemptsMade: job.attemptsMade,
        failedAt: new Date()
      });
    }
  } else {
    console.error(`❌ Worker failed:`, err);
  }
});

documentWorker.on('error', (err) => {
  console.error('🚨 Worker error:', err);
});

documentWorker.on('stalled', (jobId) => {
  console.warn(`⚠️ Job ${jobId} stalled`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🔄 Closing document worker...');
  await documentWorker.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🔄 Closing document worker...');
  await documentWorker.close();
  process.exit(0);
});

export default documentWorker;
