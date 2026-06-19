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

function remoteHasDisplayableContent(messages: ChatMessage[]) {
  return messages.some(
    (msg) =>
      (msg.role === "assistant" && msg.content.trim().length > 0) ||
      msg.role === "tool",
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

function mergeRemoteTailOntoLocal(
  local: ChatMessage[],
  remote: ChatMessage[],
): ChatMessage[] {
  const localUser = lastUserMessage(local);
  if (!localUser) return local;

  let localUserIndex = -1;
  for (let index = local.length - 1; index >= 0; index -= 1) {
    if (local[index].role === "user") {
      localUserIndex = index;
      break;
    }
  }
  if (localUserIndex < 0) return local;

  const remoteUserIndex = remote.findIndex(
    (msg) =>
      msg.role === "user" &&
      msg.content.trim() === localUser.content.trim(),
  );
  const remoteTail =
    remoteUserIndex >= 0 ? remote.slice(remoteUserIndex + 1) : remote;
  if (remoteTail.length === 0) return local;

  const prefix = local.slice(0, localUserIndex + 1);
  return normalizePlanningMessageOrder([...prefix, ...remoteTail]);
}

export function mergeServerMessagesWithLocal(
  local: ChatMessage[],
  history: HistoryMessage[],
  options?: { pollOnly?: boolean; limitedRemote?: boolean },
): ChatMessage[] {
  const remote = mapHistoryToChatMessages(history);

  if (options?.pollOnly && options?.limitedRemote && remote.length > 0) {
    const anchorIndex = local.findIndex((msg) => msg.id === remote[0]?.id);
    if (anchorIndex > 0) {
      const mergedTail = mergeServerMessagesWithLocal(
        local.slice(anchorIndex),
        history,
        { pollOnly: true },
      );
      return [...local.slice(0, anchorIndex), ...mergedTail];
    }
    if (anchorIndex === 0) {
      return mergeServerMessagesWithLocal(local, history, { pollOnly: true });
    }

    const localUser = lastUserMessage(local);
    const remoteUserIndex = localUser
      ? remote.findIndex(
          (msg) =>
            msg.role === "user" &&
            msg.content.trim() === localUser.content.trim(),
        )
      : -1;
    if (remoteUserIndex >= 0) {
      let localUserIndex = -1;
      for (let index = local.length - 1; index >= 0; index -= 1) {
        if (local[index].role === "user") {
          localUserIndex = index;
          break;
        }
      }
      if (localUserIndex >= 0) {
        const anchor = Math.max(0, localUserIndex - remoteUserIndex);
        const mergedTail = mergeServerMessagesWithLocal(
          local.slice(anchor),
          history,
          { pollOnly: true },
        );
        return [...local.slice(0, anchor), ...mergedTail];
      }
    }

    if (localUser) {
      const mergedTail = mergeRemoteTailOntoLocal(local, remote);
      if (mergedTail !== local) {
        return mergedTail;
      }
    }
  }

  const localUser = lastUserMessage(local);

  if (options?.pollOnly) {
    if (localUser && !remoteHasUserText(remote, localUser.content)) {
      if (remoteHasDisplayableContent(remote)) {
        return mergeRemoteTailOntoLocal(local, remote);
      }
      return local;
    }
    return appendStreamingPlaceholder(remote, local);
  }

  if (localUser) {
    const localText = localUser.content.trim();
    if (localText && !remoteHasUserText(remote, localText)) {
      if (remoteHasDisplayableContent(remote)) {
        return mergeRemoteTailOntoLocal(local, remote);
      }
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

export function turnHasDisplayableContent(messages: ChatMessage[]): boolean {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  for (let index = messages.length - 1; index > lastUserIndex; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === "tool") return true;
    if (message.role === "assistant" && message.content.trim()) return true;
  }
  return false;
}

function appendStreamingPlaceholder(
  remote: ChatMessage[],
  local: ChatMessage[],
): ChatMessage[] {
  const lastLocal = local[local.length - 1];
  const lastRemote = remote[remote.length - 1];
  const localTrailingPlaceholder =
    lastLocal?.role === "assistant" && !lastLocal.content.trim();
  if (!localTrailingPlaceholder) {
    return remote;
  }
  if (
    lastRemote &&
    (lastRemote.role !== "assistant" || lastRemote.content.trim())
  ) {
    return remote;
  }
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
