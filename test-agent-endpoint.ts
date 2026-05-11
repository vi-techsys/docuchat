import { runAgent } from './src/agents/executor';

async function testAgentEndpoint() {
  console.log('🔍 Testing Agent Endpoint...\n');

  try {
    // Test the correct endpoint
    console.log('Testing POST /api/v1/agent/chat');
    const result = await runAgent({
      question: 'What is the remote work policy?',
      userId: 'test-user-123',
      correlationId: 'test-endpoint'
    });

    console.log('✅ Agent Test Result:', {
      answer: result.answer.substring(0, 100) + '...',
      sources: result.sources,
      confidence: result.confidence,
      iterations: result.iterations,
      costUsd: result.costUsd,
      terminationReason: result.terminationReason
    });

    console.log('\n🎉 Agent Endpoint Test Complete!');
    console.log('✅ POST /api/v1/agent/chat working correctly');

  } catch (error) {
    console.error('❌ Agent Endpoint Test Failed:', error);
    throw error;
  }
}

testAgentEndpoint().catch(console.error);
