import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { semanticSearch } from '../../src/services/search.service';
import { assembleContext } from '../../src/services/context.service';
import { generateRAGResponse } from '../../src/services/rag-generation.service';
import { sendMessage } from '../../src/services/conversation.services';
import { createConversation } from '../../src/services/conversation.services';
import { prisma } from '../../src/lib/prisma';

describe('RAG Retrieval Quality', () => {
  let testUserId: string;
  let otherUserId: string;
  let testDocumentId: string;
  let testConversationId: string;
  let correlationId: string;

  beforeAll(async () => {
    // Create test users
    testUserId = 'test-user-' + Date.now();
    otherUserId = 'other-user-' + Date.now();
    correlationId = 'test-' + Date.now();

    // Create test documents with known content
    const testDocument = await prisma.$queryRaw`
      INSERT INTO documents (id, "userId", title, content, status, "createdAt", "updatedAt")
      VALUES (
        'test-doc-${Date.now()}', 
        ${testUserId}, 
        'Company Policies Handbook',
        $1,
        'completed',
        NOW(),
        NOW()
      )
      RETURNING id
    ` as any[];

    testDocumentId = testDocument[0].id;

    // Create test chunks with specific content for testing
    const testChunks = [
      {
        id: 'chunk-refund-' + Date.now(),
        documentId: testDocumentId,
        index: 0,
        content: 'Our refund policy allows customers to return products within 30 days of purchase. Returns must be in original condition with receipt. Refunds are processed within 5-7 business days. For defective items, we offer full refund including shipping costs.',
        tokenCount: 45,
        embedding: null // Will be populated by embedding service
      },
      {
        id: 'chunk-vacation-' + Date.now(),
        documentId: testDocumentId,
        index: 1,
        content: 'Employees are eligible for 15 days of paid vacation per year. Vacation requests must be submitted 2 weeks in advance. Manager approval is required. Unused vacation days can be carried over for 6 months.',
        tokenCount: 42,
        embedding: null
      },
      {
        id: 'chunk-sick-' + Date.now(),
        documentId: testDocumentId,
        index: 2,
        content: 'Sick leave policy provides 10 days per year. Employees must notify manager within 2 hours of start time. Doctor note required for absences over 3 days. Sick leave does not carry over to next year.',
        tokenCount: 38,
        embedding: null
      },
      {
        id: 'chunk-remote-' + Date.now(),
        documentId: testDocumentId,
        index: 3,
        content: 'Remote work is available for eligible employees. Must have dedicated home office space. Remote work requires manager approval and weekly check-ins. Company provides equipment stipend of $500 per year.',
        tokenCount: 40,
        embedding: null
      }
    ];

    // Insert test chunks
    await prisma.$queryRaw`
      INSERT INTO "Chunk" (id, "documentId", index, content, "tokenCount", "createdAt")
      VALUES 
        (${testChunks[0].id}, ${testDocumentId}, ${testChunks[0].index}, ${testChunks[0].content}, ${testChunks[0].tokenCount}, NOW()),
        (${testChunks[1].id}, ${testDocumentId}, ${testChunks[1].index}, ${testChunks[1].content}, ${testChunks[1].tokenCount}, NOW()),
        (${testChunks[2].id}, ${testDocumentId}, ${testChunks[2].index}, ${testChunks[2].content}, ${testChunks[2].tokenCount}, NOW()),
        (${testChunks[3].id}, ${testDocumentId}, ${testChunks[3].index}, ${testChunks[3].content}, ${testChunks[3].tokenCount}, NOW())
    `;

    // Create test conversation
    const conversation = await createConversation(testUserId, testDocumentId, 'Retrieval Quality Test');
    testConversationId = conversation.id;
  });

  afterAll(async () => {
    // Cleanup test data
    await prisma.$queryRaw`
      DELETE FROM messages WHERE "conversationId" = ${testConversationId}
    `;
    await prisma.$queryRaw`
      DELETE FROM "Chunk" WHERE "documentId" = ${testDocumentId}
    `;
    await prisma.$queryRaw`
      DELETE FROM documents WHERE id = ${testDocumentId}
    `;
    await prisma.$queryRaw`
      DELETE FROM conversations WHERE id = ${testConversationId}
    `;
  });

  describe('Semantic Search Quality', () => {
    it('finds refund policy when asked about returns', async () => {
      const results = await semanticSearch({
        query: 'How do I return a product?',
        userId: testUserId,
        correlationId: correlationId + '-refund'
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeGreaterThan(0.5);

      // The top result should contain refund-related content
      const topContent = results[0].content.toLowerCase();
      expect(
        topContent.includes('return') ||
        topContent.includes('refund') ||
        topContent.includes('reimbursement')
      ).toBe(true);

      // Should find the refund chunk specifically
      const refundChunk = results.find(r => 
        r.content.toLowerCase().includes('refund policy')
      );
      expect(refundChunk).toBeDefined();
      expect(refundChunk!.score).toBeGreaterThan(0.7);
    });

    it('finds vacation policy when asked about time off', async () => {
      const results = await semanticSearch({
        query: 'How many vacation days do I get?',
        userId: testUserId,
        correlationId: correlationId + '-vacation'
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeGreaterThan(0.5);

      const topContent = results[0].content.toLowerCase();
      expect(
        topContent.includes('vacation') ||
        topContent.includes('paid time off') ||
        topContent.includes('days')
      ).toBe(true);
    });

    it('finds sick leave policy when asked about illness', async () => {
      const results = await semanticSearch({
        query: 'What do I do if I am sick?',
        userId: testUserId,
        correlationId: correlationId + '-sick'
      });

      expect(results.length).toBeGreaterThan(0);
      
      const sickContent = results.find(r => 
        r.content.toLowerCase().includes('sick leave')
      );
      expect(sickContent).toBeDefined();
      expect(sickContent!.score).toBeGreaterThan(0.6);
    });

    it('finds remote work policy when asked about working from home', async () => {
      const results = await semanticSearch({
        query: 'Can I work from home?',
        userId: testUserId,
        correlationId: correlationId + '-remote'
      });

      expect(results.length).toBeGreaterThan(0);
      
      const remoteContent = results.find(r => 
        r.content.toLowerCase().includes('remote work')
      );
      expect(remoteContent).toBeDefined();
    });

    it('returns low scores for irrelevant questions', async () => {
      const results = await semanticSearch({
        query: 'What is quantum computing?',
        userId: testUserId,
        minScore: 0.5,
        correlationId: correlationId + '-quantum'
      });

      // Should return nothing if documents are about company policies
      expect(results.length).toBe(0);
    });

    it('respects document ownership', async () => {
      const results = await semanticSearch({
        query: 'return policy',
        userId: otherUserId, // Different user
        correlationId: correlationId + '-ownership'
      });

      // Should not find testUser's documents
      expect(results.length).toBe(0);
    });

    it('maintains score ordering by relevance', async () => {
      const results = await semanticSearch({
        query: 'return refund money back',
        userId: testUserId,
        correlationId: correlationId + '-ordering'
      });

      expect(results.length).toBeGreaterThan(1);
      
      // Results should be sorted by score (descending)
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
      }
    });
  });

  describe('Context Assembly Quality', () => {
    it('assembles context within token budget', async () => {
      const searchResults = await semanticSearch({
        query: 'vacation time off',
        userId: testUserId,
        correlationId: correlationId + '-context'
      });

      const context = assembleContext(searchResults, { tokenBudget: 100 });

      expect(context.totalTokens).toBeLessThanOrEqual(100);
      expect(context.chunks.length).toBeGreaterThan(0);
      expect(context.citations.length).toBe(context.chunks.length);
    });

    it('applies deduplication correctly', async () => {
      const searchResults = await semanticSearch({
        query: 'company policies',
        userId: testUserId,
        topK: 10,
        correlationId: correlationId + '-dedup'
      });

      const contextWithDedup = assembleContext(searchResults, { enableDeduplication: true });
      const contextWithoutDedup = assembleContext(searchResults, { enableDeduplication: false });

      // With deduplication, we should have fewer or equal chunks
      expect(contextWithDedup.chunks.length).toBeLessThanOrEqual(contextWithoutDedup.chunks.length);
    });

    it('generates proper citations', async () => {
      const searchResults = await semanticSearch({
        query: 'refund policy',
        userId: testUserId,
        correlationId: correlationId + '-citations'
      });

      const context = assembleContext(searchResults);

      context.citations.forEach((citation, index) => {
        expect(citation.index).toBe(index + 1);
        expect(citation.chunkId).toBeDefined();
        expect(citation.documentId).toBe(testDocumentId);
        expect(citation.documentTitle).toBe('Company Policies Handbook');
        expect(citation.score).toBeGreaterThan(0);
        expect(citation.score).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('End-to-End RAG Quality', () => {
    it('generates relevant answers with citations', async () => {
      const response = await sendMessage({
        conversationId: testConversationId,
        userId: testUserId,
        content: 'What is your refund policy?',
        documentId: testDocumentId,
        correlationId: correlationId + '-e2e'
      });

      expect(response.userMessage).toBeDefined();
      expect(response.assistantMessage).toBeDefined();
      expect(response.assistantMessage.content).toBeTruthy();
      expect(response.assistantMessage.content.length).toBeGreaterThan(10);

      // Should include citations if relevant content was found
      if (response.assistantMessage.citations.length > 0) {
        expect(response.assistantMessage.citations[0].documentTitle).toBe('Company Policies Handbook');
      }

      // Should include context information
      expect(response.assistantMessage.context).toBeDefined();
      expect(response.assistantMessage.usage).toBeDefined();
    });

    it('handles questions with no relevant context', async () => {
      const response = await sendMessage({
        conversationId: testConversationId,
        userId: testUserId,
        content: 'What is the meaning of life?',
        documentId: testDocumentId,
        correlationId: correlationId + '-no-context'
      });

      expect(response.assistantMessage.content).toBeTruthy();
      
      // Should indicate no information found
      const answer = response.assistantMessage.content.toLowerCase();
      expect(
        answer.includes('could not find') ||
        answer.includes('no information') ||
        answer.includes('could not locate')
      ).toBe(true);

      // Should have no citations
      expect(response.assistantMessage.citations.length).toBe(0);
    });
  });
});
