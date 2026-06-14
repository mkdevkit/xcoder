import type { ChatMessage } from "../types/agent";
import type { HistoryMessage } from "../types/agent";

export function normalizePlanningMessageOrder(
  messages: ChatMessage[],
): ChatMessage[] {
  const result = [...messages];
  let index = 0;
  while (index + 1 < result.length) {
    const current = result[index];
    const next = result[index + 1];
    if (
      current.role === "assistant" &&
      next.role === "tool" &&
      next.toolName === "task"
    ) {
      [result[index], result[index + 1]] = [result[index + 1], result[index]];
      index += 2;
      continue;
    }
    index += 1;
  }
  return result;
}

export function mapHistoryToChatMessages(history: HistoryMessage[]): ChatMessage[] {
  const messages = history.map((item) => ({
    id: item.id,
    role: item.role as ChatMessage["role"],
    content: item.content,
    timestamp: item.timestamp || Date.now(),
    toolName: item.tool_name,
  }));
  return normalizePlanningMessageOrder(messages);
}

function lastUserMessage(messages: ChatMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") {
      return messages[i];
    }
  }
  return undefined;
}

function remoteHasUserText(messages: ChatMessage[], text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return messages.some(
    (msg) => msg.role === "user" && msg.content.trim() === trimmed,
  );
}

function latestAssistantText(messages: ChatMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "assistant") {
      return messages[i].content;
    }
  }
  return "";
}

export function mergeServerMessagesWithLocal(
  local: ChatMessage[],
  history: HistoryMessage[],
  options?: { pollOnly?: boolean },
): ChatMessage[] {
  const remote = mapHistoryToChatMessages(history);
  const localUser = lastUserMessage(local);

  if (options?.pollOnly) {
    if (localUser && !remoteHasUserText(remote, localUser.content)) {
      return local;
    }
    return appendStreamingPlaceholder(remote, local);
  }

  if (localUser) {
    const localText = localUser.content.trim();
    if (localText && !remoteHasUserText(remote, localText)) {
      return local;
    }
  }

  let merged = appendStreamingPlaceholder(remote, local);

  const localAssistant = latestAssistantText(local);
  const remoteAssistant = latestAssistantText(merged);
  if (
    localAssistant.length > remoteAssistant.length &&
    (remoteAssistant.length === 0 ||
      localAssistant.startsWith(remoteAssistant))
  ) {
    for (let i = merged.length - 1; i >= 0; i -= 1) {
      if (merged[i].role === "assistant") {
        merged = [
          ...merged.slice(0, i),
          { ...merged[i], content: localAssistant },
          ...merged.slice(i + 1),
        ];
        break;
      }
    }
  }

  return merged;
}

function appendStreamingPlaceholder(
  remote: ChatMessage[],
  local: ChatMessage[],
): ChatMessage[] {
  const lastLocal = local[local.length - 1];
  const lastRemote = remote[remote.length - 1];
  if (
    lastLocal?.role === "assistant" &&
    !lastLocal.content.trim() &&
    lastRemote?.role !== "assistant"
  ) {
    return [
      ...remote,
      {
        id: lastLocal.id,
        role: "assistant",
        content: "",
        timestamp: lastLocal.timestamp,
      },
    ];
  }
  if (
    lastLocal?.role === "assistant" &&
    !lastLocal.content.trim() &&
    lastRemote?.role === "assistant" &&
    !lastRemote.content.trim()
  ) {
    return remote;
  }
  return remote;
}
