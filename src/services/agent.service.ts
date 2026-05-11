import { openaiWithBreaker } from '../lib/http/openai.breaker';
import { customLogger } from '../lib/logger';
import { TOOL_REGISTRY, getToolSchemas } from '../agents/tools/registry';
import { ToolContext } from '../agents/tools/index';

interface AgentRequest {
  userId: string;
  question: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  correlationId?: string;
  documentId?: string;
}

interface AgentResponse {
  answer: string;
  toolCalls: Array<{
    name: string;
    parameters: any;
    result: any;
  }>;
  sources: string[];
  confidence: 'high' | 'medium' | 'low';
  tokensUsed: {
    input: number;
    output: number;
    total: number;
  };
  costUsd: number;
  processingTime: number;
}

export async function runAgent(request: AgentRequest): Promise<AgentResponse> {
  const startTime = Date.now();
  const { correlationId = 'unknown' } = request;

  try {
    customLogger.info('Starting agent execution', {
      correlationId,
      userId: request.userId,
      question: request.question.substring(0, 100),
      documentId: request.documentId
    });

    // Prepare messages for agent
    const messages = [
      {
        role: 'system' as const,
        content: `You are DocuChat Agent, an AI assistant that helps users find information in their documents.

You have access to the following tools:
1. search_documents - Search for relevant information in user's documents
2. final_answer - Provide the final answer when you have enough information

Your task is to:
1. Understand the user's question
2. Use search_documents to find relevant information
3. Analyze the search results
4. Provide a comprehensive answer using final_answer

Important guidelines:
- Always search for information before answering
- If no relevant information is found, say so clearly
- Cite your sources properly
- Be helpful and accurate
- Use multiple searches if needed for complex questions`
      },
      ...(request.conversationHistory || []),
      {
        role: 'user' as const,
        content: request.question
      }
    ];

    // First attempt with tools
    const response = await openaiWithBreaker.chatCompletion(
      messages,
      {
        tools: getToolSchemas(),
        tool_choice: 'auto',
        model: 'gpt-4o',
        temperature: 0.1,
        max_tokens: 1500,
      }
    );

    const assistantMessage = response.data.choices[0].message;
    const toolCalls = assistantMessage.tool_calls || [];
    const toolResults: Array<{ name: string; parameters: any; result: any }> = [];

    // Execute tool calls
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      const tool = TOOL_REGISTRY[toolName];

      if (!tool) {
        customLogger.warn('Unknown tool called', {
          correlationId,
          toolName,
          availableTools: Object.keys(TOOL_REGISTRY)
        });
        continue;
      }

      try {
        const parameters = JSON.parse(toolCall.function.arguments);
        const toolContext: ToolContext = {
          userId: request.userId,
          correlationId: `${correlationId}-${toolName}`
        };

        customLogger.info('Executing tool', {
          correlationId: toolContext.correlationId,
          toolName,
          parameters
        });

        const result = await tool.handler(parameters, toolContext);
        
        toolResults.push({
          name: toolName,
          parameters,
          result: result.success ? result.data : { error: 'Tool execution failed' }
        });

        customLogger.info('Tool executed successfully', {
          correlationId: toolContext.correlationId,
          toolName,
          success: result.success
        });

      } catch (error) {
        const parsedArgs = JSON.parse(toolCall.function.arguments);
        customLogger.error('Tool execution failed', {
          correlationId: `${correlationId}-${toolName}`,
          toolName,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        toolResults.push({
          name: toolName,
          parameters: parsedArgs,
          result: { error: error instanceof Error ? error.message : 'Unknown error' }
        });
      }
    }

    // Get final answer
    let finalAnswer = '';
    let sources: string[] = [];
    let confidence: 'high' | 'medium' | 'low' = 'medium';

    if (toolResults.length > 0) {
      // Add tool results to conversation
      const messagesWithTools: any[] = [
        ...messages,
        assistantMessage,
        ...toolResults.map(result => ({
          role: 'tool' as const,
          tool_call_id: toolCalls.find(tc => tc.function.name === result.name)?.id,
          content: JSON.stringify(result.result)
        }))
      ];

      const finalResponse = await openaiWithBreaker.chatCompletion(
        messagesWithTools,
        {
          model: 'gpt-4o',
          temperature: 0.1,
          max_tokens: 1500,
        }
      );

      finalAnswer = finalResponse.data.choices[0].message.content || '';

      // Extract sources from search results
      const searchResult = toolResults.find((tr: any) => tr.name === 'search_documents');
      if (searchResult?.result?.results) {
        sources = [...new Set(searchResult.result.results.map((r: any) => r.document as string))];
      }

      // Determine confidence based on search results
      if (searchResult?.result?.totalResults > 0) {
        const firstResult = searchResult.result.results[0];
        confidence = firstResult.score > 0.8 ? 'high' : 
                   firstResult.score > 0.5 ? 'medium' : 'low';
      } else {
        confidence = 'low';
      }

    } else {
      // No tools were called, provide direct response
      finalAnswer = assistantMessage.content || 'I need to search your documents to answer that question.';
    }

    const processingTime = Date.now() - startTime;
    const usage = response.data.usage;

    customLogger.info('Agent execution completed', {
      correlationId,
      processingTime,
      toolCallsCount: toolCalls.length,
      toolResultsCount: toolResults.length,
      sourcesCount: sources.length,
      confidence
    });

    return {
      answer: finalAnswer,
      toolCalls: toolResults,
      sources,
      confidence,
      tokensUsed: {
        input: usage?.prompt_tokens || 0,
        output: usage?.completion_tokens || 0,
        total: usage?.total_tokens || 0
      },
      costUsd: (usage?.total_tokens || 0) * 0.0000025, // GPT-4o rate
      processingTime
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    customLogger.error('Agent execution failed', {
      correlationId,
      error: error instanceof Error ? error.message : 'Unknown error',
      processingTime
    });

    throw error;
  }
}
