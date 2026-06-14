import type { ChatMessage } from "../types/agent";
import type { HistoryMessage } from "../types/agent";

export function mapHistoryToChatMessages(history: HistoryMessage[]): ChatMessage[] {
  return history.map((item) => ({
    id: item.id,
    role: item.role as ChatMessage["role"],
    content: item.content,
    timestamp: item.timestamp || Date.now(),
    toolName: item.tool_name,
  }));
}
