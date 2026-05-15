import { Queue, QueueOptions } from 'bullmq';
import { redisConnection } from './connection';

export interface DocumentProcessingJob {
  documentId: string;
  userId: string;
}

// Queue configuration with retry strategy and rate limiting
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
  settings: {
    // Rate limiting: max 10 documents per minute per user
    maxStalledCount: 2,
    stalledInterval: 5000,
    lockDuration: 30000,
    lockRenewTime: 15000,
  },
};

// Create the document processing queue
export const documentQueue = new Queue<DocumentProcessingJob>('document-processing', queueOptions);

// Function to queue a document for processing with rate limiting
export async function queueDocumentForProcessing(documentId: string, userId: string) {
  try {
    // Check user's current queue load for rate limiting
    const userJobs = await documentQueue.getJobs(['waiting', 'active']);
    const userJobCount = userJobs.filter(job => job.data.userId === userId).length;
    
    // Rate limit: max 5 concurrent documents per user
    if (userJobCount >= 5) {
      throw new Error(`Rate limit exceeded: User has ${userJobCount} documents in queue. Max: 5`);
    }

    const job = await documentQueue.add(
      'process-document',
      { documentId, userId },
      {
        // Job-specific options
        removeOnComplete: 10,
        removeOnFail: 10,
        priority: 0, // Standard priority (lower = higher priority)
        delay: 0, // Process immediately
      }
    );

    console.log(`📝 Document ${documentId} queued for processing (job ID: ${job.id})`);
    return job;
  } catch (error) {
    console.error(`❌ Failed to queue document ${documentId}:`, (error as Error).message);
    throw error;
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

// Function to get user's queue load
export async function getUserQueueLoad(userId: string) {
  const jobs = await documentQueue.getJobs(['waiting', 'active']);
  const userJobs = jobs.filter(job => job.data.userId === userId);
  return {
    waitingCount: userJobs.filter(j => j.getState().then(s => s === 'waiting')).length,
    activeCount: userJobs.filter(j => j.getState().then(s => s === 'active')).length,
    totalCount: userJobs.length,
    maxConcurrent: 5,
  };
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
