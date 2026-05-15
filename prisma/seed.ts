import { PrismaClient } from '@prisma/client';
import { RAG_SYSTEM_PROMPT, RAG_NO_CONTEXT_PROMPT, AGENT_SYSTEM_PROMPT, CONVERSATION_SUMMARY_PROMPT } from '../src/config/prompts';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding prompt templates...');

  // Chat prompts
  await prisma.promptTemplate.upsert({
    where: { taskType_version: { taskType: 'chat', version: 'v1' } },
    update: {},
    create: {
      taskType: 'chat',
      version: 'v1',
      name: 'RAG Chat - Initial',
      content: RAG_SYSTEM_PROMPT,
      isActive: true,
      metadata: JSON.stringify({
        author: 'system',
        changelog: 'Initial version of RAG chat prompt',
      }),
    },
  });

  await prisma.promptTemplate.upsert({
    where: { taskType_version: { taskType: 'chat', version: 'v2' } },
    update: {},
    create: {
      taskType: 'chat',
      version: 'v2',
      name: 'RAG Chat - No Context',
      content: RAG_NO_CONTEXT_PROMPT,
      isActive: false,
      metadata: JSON.stringify({
        author: 'system',
        changelog: 'Fallback prompt when no context is available',
      }),
    },
  });

  // Agent prompts
  await prisma.promptTemplate.upsert({
    where: { taskType_version: { taskType: 'agent', version: 'v1' } },
    update: {},
    create: {
      taskType: 'agent',
      version: 'v1',
      name: 'Research Agent - Initial',
      content: AGENT_SYSTEM_PROMPT,
      isActive: true,
      metadata: JSON.stringify({
        author: 'system',
        changelog: 'Initial version of research agent prompt',
      }),
    },
  });

  // Summary prompts
  await prisma.promptTemplate.upsert({
    where: { taskType_version: { taskType: 'summary', version: 'v1' } },
    update: {},
    create: {
      taskType: 'summary',
      version: 'v1',
      name: 'Conversation Summary - Initial',
      content: CONVERSATION_SUMMARY_PROMPT,
      isActive: true,
      metadata: JSON.stringify({
        author: 'system',
        changelog: 'Initial version of conversation summary prompt',
      }),
    },
  });

  // Embedding prompts
  await prisma.promptTemplate.upsert({
    where: { taskType_version: { taskType: 'embedding', version: 'v1' } },
    update: {},
    create: {
      taskType: 'embedding',
      version: 'v1',
      name: 'Text Embedding - Initial',
      content: 'Text embedding operation for semantic search and vector similarity. Converts text input to numerical vector representations using OpenAI embedding models.',
      isActive: true,
      metadata: JSON.stringify({
        author: 'system',
        changelog: 'Initial version of text embedding configuration',
      }),
    },
  });

  console.log('Prompt templates seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
