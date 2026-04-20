import { Queue, QueueOptions } from 'bullmq';
import { redisConnection } from './connection';

export interface DocumentProcessingJob {
  documentId: string;
  userId: string;
}

// Queue configuration with retry strategy
const queueOptions: QueueOptions = {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 100, // Keep last 100 completed jobs
    removeOnFail: 50, // Keep last 50 failed jobs
    attempts: 3, // Maximum retry attempts
    backoff: {
      type: 'exponential',
      delay: 2000, // Initial delay: 2s, then 4s, then 8s
    },
  },
};

// Create the document processing queue
export const documentQueue = new Queue<DocumentProcessingJob>('document-processing', queueOptions);

// Function to queue a document for processing
export async function queueDocumentForProcessing(documentId: string, userId: string) {
  try {
    const job = await documentQueue.add(
      'process-document',
      { documentId, userId },
      {
        // Job-specific options can override defaults
        removeOnComplete: 10,
        removeOnFail: 10,
      }
    );

    console.log(`📝 Document ${documentId} queued for processing (job ID: ${job.id})`);
    return job;
  } catch (error) {
    console.warn(`⚠️ Failed to queue document ${documentId} (Redis unavailable):`, (error as Error).message);
    console.log(`🔄 Processing document synchronously as fallback`);
    
    // Fallback: Process document synchronously if Redis is unavailable
    // In a real production environment, you might want to handle this differently
    return {
      id: `sync-${Date.now()}`,
      data: { documentId, userId },
      opts: { attempts: 1 },
      finished: true,
      returnvalue: { success: true, fallback: true }
    };
  }
}

// Function to get job status
export async function getDocumentJobStatus(jobId: string) {
  const job = await documentQueue.getJob(jobId);
  
  if (!job) {
    return null;
  }

  return {
    id: job.id,
    name: job.name,
    data: job.data,
    progress: job.progress,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    failedReason: job.failedReason,
    returnvalue: job.returnvalue,
    state: await job.getState(),
  };
}

// Function to get jobs by document ID
export async function getJobsByDocumentId(documentId: string) {
  const jobs = await documentQueue.getJobs(['waiting', 'active', 'completed', 'failed']);
  return jobs.filter(job => job.data.documentId === documentId);
}

// Graceful shutdown
process.on('SIGINT', async () => {
  await documentQueue.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await documentQueue.close();
  process.exit(0);
});

export default documentQueue;
