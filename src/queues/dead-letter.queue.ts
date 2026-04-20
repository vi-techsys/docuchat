import { Queue, QueueOptions } from 'bullmq';
import { redisConnection } from './connection';

export interface DeadLetterJobData {
  originalJobData: any;
  error: string;
  attemptsMade: number;
  failedAt: Date;
}

// Dead letter queue configuration
const queueOptions: QueueOptions = {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 1000, // Keep dead letter jobs longer for inspection
    removeOnFail: 1000,
    attempts: 0, // No retries for dead letter jobs
  },
};

// Create the dead letter queue
export const deadLetterQueue = new Queue<DeadLetterJobData>('dead-letter', queueOptions);

// Function to get dead letter jobs
export async function getDeadLetterJobs() {
  const jobs = await deadLetterQueue.getJobs(['completed', 'failed']);
  return jobs;
}

// Function to retry a dead letter job
export async function retryDeadLetterJob(jobId: string) {
  const job = await deadLetterQueue.getJob(jobId);
  if (job && job.data.originalJobData) {
    // Import here to avoid circular dependency
    const { documentQueue } = await import('./document.queue');
    await documentQueue.add('process-document', job.data.originalJobData);
    await job.remove(); // Remove from dead letter queue
    return true;
  }
  return false;
}

// Graceful shutdown
process.on('SIGINT', async () => {
  await deadLetterQueue.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await deadLetterQueue.close();
  process.exit(0);
});

export default deadLetterQueue;
