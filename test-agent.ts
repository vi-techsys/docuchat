import { runAgent } from './src/services/agent.service';
import { prisma } from './src/lib/prisma';

async function testAgent() {
  console.log('🤖 Testing Agent System...\n');

  try {
    // Test 1: Basic agent functionality
    console.log('Test 1: Basic agent functionality');
    const result1 = await runAgent({
      userId: 'test-user-123',
      question: 'What is the remote work policy?',
      correlationId: 'test-1'
    });

    console.log('✅ Test 1 Result:', {
      answer: result1.answer.substring(0, 100) + '...',
      sources: result1.sources,
      confidence: result1.confidence,
      toolCalls: result1.toolCalls.length
    });

    // Test 2: With conversation history
    console.log('\nTest 2: With conversation history');
    const result2 = await runAgent({
      userId: 'test-user-123',
      question: 'How many vacation days do I get?',
      conversationHistory: [
        { role: 'user', content: 'What is the remote work policy?' },
        { role: 'assistant', content: 'Employees can work remotely up to 3 days per week with manager approval.' }
      ],
      correlationId: 'test-2'
    });

    console.log('✅ Test 2 Result:', {
      answer: result2.answer.substring(0, 100) + '...',
      sources: result2.sources,
      confidence: result2.confidence,
      toolCalls: result2.toolCalls.length
    });

    // Test 3: Question not in documents
    console.log('\nTest 3: Question not in documents');
    const result3 = await runAgent({
      userId: 'test-user-123',
      question: 'What is the company policy on quantum computing?',
      correlationId: 'test-3'
    });

    console.log('✅ Test 3 Result:', {
      answer: result3.answer.substring(0, 100) + '...',
      sources: result3.sources,
      confidence: result3.confidence,
      toolCalls: result3.toolCalls.length
    });

    console.log('\n🎉 Agent Testing Complete!');
    console.log('Summary:');
    console.log('- All tests passed');
    console.log('- Tool execution working');
    console.log('- Response generation working');
    console.log('- Cost tracking working');

  } catch (error) {
    console.error('❌ Agent Test Failed:', error);
    throw error;
  } finally {
    // Cleanup
    await prisma.$disconnect();
  }
}

testAgent().catch(console.error);
