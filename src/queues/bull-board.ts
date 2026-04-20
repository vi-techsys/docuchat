import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { documentQueue } from './document.queue';
import { deadLetterQueue } from './dead-letter.queue';
import { redisConnection } from './connection';

// Create Bull Board instance
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

const bullBoard = createBullBoard({
  queues: [
    new BullMQAdapter(documentQueue, { readOnlyMode: false }),
    new BullMQAdapter(deadLetterQueue, { readOnlyMode: false }),
  ],
  serverAdapter,
  options: {
    uiConfig: {
      boardTitle: 'DocuChat Queue Monitoring',
      boardLogo: {
        path: '/logo.png',
        width: '100px',
        height: 'auto',
      },
      miscLinks: [
        { text: 'Dashboard', url: '/' },
        { text: 'API Docs', url: '/api/v1' },
      ],
    },
  },
});

export { bullBoard, serverAdapter };

// Function to setup Bull Board routes
export function setupBullBoard(app: any) {
  app.use('/admin/queues', serverAdapter.getRouter());
  
  console.log('📊 Bull Board available at /admin/queues');
  console.log('📋 Monitoring queues: document-processing, dead-letter');
}
