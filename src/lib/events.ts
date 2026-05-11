import { EventEmitter } from 'events';

export interface AgentEvent {
  type: 'agent_started' | 'agent_completed' | 'agent_timeout' | 'agent_cost_limit' | 'agent_iteration_limit' | 'tool_called' | 'tool_error';
  data: any;
  correlationId: string;
  userId: string;
  timestamp: Date;
}

class AppEvents extends EventEmitter {
  emitAgentEvent(event: Omit<AgentEvent, 'timestamp'> & { correlationId: string; userId: string }) {
    this.emit('agent_event', {
      ...event,
      timestamp: new Date(),
      correlationId: event.correlationId,
      userId: event.userId
    });
  }
}

export const appEvents = new AppEvents();

// Export event emitter for global use
export default appEvents;
