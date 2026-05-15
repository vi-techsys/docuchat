import { mcpComplete, MCPRequest } from './mcp.service';
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
    customLogger.info(`Starting agent execution - correlationId: ${correlationId}, userId: ${request.userId}, question: ${request.question.substring(0, 100)}, documentId: ${request.documentId}`);

    // Prepare messages for agent
    const messages = [
      ...(request.conversationHistory || []),
      {
        role: 'user' as const,
        content: request.question
      }
    ];

    // First attempt with tools
    const mcpRequest: MCPRequest = {
      taskType: 'agent',
      messages,
      userId: request.userId,
      correlationId,
      tools: getToolSchemas(),
      temperature: 0.1,
      maxTokens: 1500,
    };

    const response = await mcpComplete(mcpRequest);

    const assistantMessage = {
      content: response.content,
      tool_calls: response.toolCalls,
    };
    const toolCalls = response.toolCalls || [];
    const toolResults: Array<{ name: string; parameters: any; result: any }> = [];

    // Execute tool calls
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      const tool = TOOL_REGISTRY[toolName];

      if (!tool) {
        customLogger.warn(`Unknown tool called - correlationId: ${correlationId}, toolName: ${toolName}, availableTools: ${Object.keys(TOOL_REGISTRY).join(', ')}`);
        continue;
      }

      try {
        const parameters = JSON.parse(toolCall.function.arguments);
        const toolContext: ToolContext = {
          userId: request.userId,
          correlationId: `${correlationId}-${toolName}`
        };

        customLogger.info(`Executing tool - correlationId: ${toolContext.correlationId}, toolName: ${toolName}, parameters: ${JSON.stringify(parameters)}`);

        const result = await tool.handler(parameters, toolContext);
        
        toolResults.push({
          name: toolName,
          parameters,
          result: result.success ? result.data : { error: 'Tool execution failed' }
        });

        customLogger.info(`Tool executed successfully - correlationId: ${toolContext.correlationId}, toolName: ${toolName}, success: ${result.success}`);

      } catch (error) {
        const parsedArgs = JSON.parse(toolCall.function.arguments);
        customLogger.error(`Tool execution failed - correlationId: ${correlationId}-${toolName}, toolName: ${toolName}, error: ${error instanceof Error ? error.message : 'Unknown error'}`);

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

      const finalMcpRequest: MCPRequest = {
        taskType: 'agent',
        messages: messagesWithTools,
        userId: request.userId,
        correlationId: `${correlationId}-final`,
        temperature: 0.1,
        maxTokens: 1500,
      };

      const finalResponse = await mcpComplete(finalMcpRequest);

      finalAnswer = finalResponse.content;

      // Extract sources from search results
      const searchResult = toolResults.find((tr: any) => tr.name === 'search_documents');
      if (searchResult?.result?.results) {
        const sourceDocs = searchResult.result.results
          .map((r: any) => r.document as string)
          .filter((s: string) => typeof s === 'string') as string[];
        sources = [...new Set(sourceDocs)];
      }

      // Determine confidence based on search results
      if (searchResult?.result?.totalResults && searchResult.result.totalResults > 0) {
        const firstResult = searchResult.result.results[0];
        confidence = firstResult.score > 0.8 ? 'high' : 
                   firstResult.score > 0.5 ? 'medium' : 'low';
      } else {
        confidence = 'low';
      }

    } else {
      // No tools were called, provide direct response
      finalAnswer = response.content || 'I need to search your documents to answer that question.';
    }

    const processingTime = Date.now() - startTime;
    const totalTokensUsed = response.tokensUsed.total + (toolResults.length > 0 ? response.tokensUsed.total : 0);
    const totalCost = response.costUsd + (toolResults.length > 0 ? response.costUsd : 0);

    customLogger.info(`Agent execution completed - correlationId: ${correlationId}, processingTime: ${processingTime}, toolCallsCount: ${toolCalls.length}, toolResultsCount: ${toolResults.length}, sourcesCount: ${sources.length}, confidence: ${confidence}, model: ${response.model}, promptVersion: ${response.promptVersion}, fallbackUsed: ${response.fallbackUsed}`);

    return {
      answer: finalAnswer,
      toolCalls: toolResults,
      sources,
      confidence,
      tokensUsed: {
        input: response.tokensUsed.prompt,
        output: response.tokensUsed.completion,
        total: totalTokensUsed
      },
      costUsd: totalCost,
      processingTime
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    customLogger.error(`Agent execution failed - correlationId: ${correlationId}, error: ${error instanceof Error ? error.message : 'Unknown error'}, processingTime: ${processingTime}`);

    throw error;
  }
}
