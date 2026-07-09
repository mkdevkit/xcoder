import type { ChatMessage } from "../types/agent";
import type { HistoryMessage } from "../types/agent";
import type { ActiveTurn } from "./turnState";

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
    turnId: item.turn_id,
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

function lastUserIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") {
      return i;
    }
  }
  return -1;
}

function latestAssistantTextInTurn(messages: ChatMessage[]): string {
  const userIndex = lastUserIndex(messages);
  for (let i = messages.length - 1; i > userIndex; i -= 1) {
    if (messages[i].role === "assistant") {
      return messages[i].content;
    }
  }
  return "";
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

function prefixMessageIds(prefix: ChatMessage[]): Set<string> {
  return new Set(prefix.map((msg) => msg.id));
}

function remoteTailForCurrentTurn(
  prefix: ChatMessage[],
  remote: ChatMessage[],
  localUser: ChatMessage,
  activeTurn?: ActiveTurn | null,
): ChatMessage[] {
  if (activeTurn?.anchorKind === "message_id") {
    const remoteUserIndex = remote.findIndex(
      (msg) => msg.role === "user" && msg.id === activeTurn.anchorId,
    );
    if (remoteUserIndex >= 0) {
      return remote.slice(remoteUserIndex + 1);
    }
  }

  if (activeTurn?.anchorKind === "turn_id") {
    const remoteUserIndex = remote.findIndex(
      (msg) => msg.role === "user" && msg.turnId === activeTurn.anchorId,
    );
    if (remoteUserIndex >= 0) {
      return remote
        .slice(remoteUserIndex + 1)
        .filter(
          (msg) => !msg.turnId || msg.turnId === activeTurn.anchorId,
        );
    }
  }

  const remoteUserIndex = remote.findIndex(
    (msg) =>
      msg.role === "user" &&
      msg.content.trim() === localUser.content.trim(),
  );
  if (remoteUserIndex >= 0) {
    return remote.slice(remoteUserIndex + 1);
  }

  const knownIds = prefixMessageIds(prefix);
  const novel = remote.filter((msg) => !knownIds.has(msg.id));
  if (novel.length > 0) {
    return novel;
  }

  return [];
}

function mergeTurnTail(
  localTurnTail: ChatMessage[],
  remoteTurnTail: ChatMessage[],
): ChatMessage[] {
  if (remoteTurnTail.length === 0) {
    return localTurnTail;
  }

  if (localTurnTail.length === 0) {
    return remoteTurnTail;
  }

  const anchorIndex = localTurnTail.findIndex(
    (msg) => msg.id === remoteTurnTail[0]?.id,
  );
  if (anchorIndex >= 0) {
    const mergedTail = mergeTurnTail(
      localTurnTail.slice(anchorIndex),
      remoteTurnTail,
    );
    return [...localTurnTail.slice(0, anchorIndex), ...mergedTail];
  }

  return appendStreamingPlaceholder(remoteTurnTail, localTurnTail);
}

function reconcileCurrentUser(
  localUser: ChatMessage,
  remote: ChatMessage[],
  activeTurn?: ActiveTurn | null,
): ChatMessage {
  if (activeTurn?.anchorKind === "message_id") {
    const remoteUser = remote.find(
      (msg) => msg.role === "user" && msg.id === activeTurn.anchorId,
    );
    if (remoteUser) {
      return {
        ...localUser,
        id: remoteUser.id,
        turnId: remoteUser.turnId,
      };
    }
  }

  if (activeTurn?.anchorKind === "turn_id") {
    const remoteUser = remote.find(
      (msg) => msg.role === "user" && msg.turnId === activeTurn.anchorId,
    );
    if (remoteUser) {
      return {
        ...localUser,
        id: remoteUser.id,
        turnId: activeTurn.anchorId,
      };
    }
  }

  const remoteUser = remote.find(
    (msg) =>
      msg.role === "user" &&
      msg.content.trim() === localUser.content.trim(),
  );
  if (remoteUser) {
    return {
      ...localUser,
      id: remoteUser.id,
      turnId: remoteUser.turnId ?? localUser.turnId,
    };
  }

  return localUser;
}

function mergeCurrentTurnFromRemote(
  local: ChatMessage[],
  remote: ChatMessage[],
  activeTurn?: ActiveTurn | null,
): ChatMessage[] {
  const localUserIndex = lastUserIndex(local);
  if (localUserIndex < 0) {
    return remote.length > 0 ? remote : local;
  }

  const localUser = local[localUserIndex];
  const reconciledUser = reconcileCurrentUser(localUser, remote, activeTurn);
  const prefix = [
    ...local.slice(0, localUserIndex),
    reconciledUser,
  ];
  const localTurnTail = local.slice(localUserIndex + 1);
  const remoteTurnTail = remoteTailForCurrentTurn(
    prefix,
    remote,
    reconciledUser,
    activeTurn,
  );

  if (remoteTurnTail.length === 0) {
    return local;
  }

  const mergedTurnTail = mergeTurnTail(localTurnTail, remoteTurnTail);
  return normalizePlanningMessageOrder([...prefix, ...mergedTurnTail]);
}

export function markCurrentTurnCancelled(
  messages: ChatMessage[],
  notice: string,
): ChatMessage[] {
  const userIndex = lastUserIndex(messages);
  if (userIndex < 0) return messages;

  const trimmedNotice = notice.trim();
  let targetIndex = -1;
  for (let i = messages.length - 1; i > userIndex; i -= 1) {
    if (messages[i].role === "assistant") {
      targetIndex = i;
      break;
    }
  }

  if (targetIndex < 0) {
    return [
      ...messages,
      {
        id: `cancelled-${Date.now()}`,
        role: "assistant",
        content: trimmedNotice,
        timestamp: Date.now(),
      },
    ];
  }

  const target = messages[targetIndex];
  const content = target.content.trim();
  if (
    content === trimmedNotice ||
    content.endsWith(trimmedNotice) ||
    content.includes("已取消") ||
    content.toLowerCase().includes("cancelled") ||
    content.toLowerCase().includes("aborted")
  ) {
    return messages;
  }

  const nextContent = content ? `${content}\n\n${trimmedNotice}` : trimmedNotice;
  return [
    ...messages.slice(0, targetIndex),
    { ...target, content: nextContent },
    ...messages.slice(targetIndex + 1),
  ];
}

export function mergeServerMessagesWithLocal(
  local: ChatMessage[],
  history: HistoryMessage[],
  options?: {
    pollOnly?: boolean;
    limitedRemote?: boolean;
    activeTurn?: ActiveTurn | null;
  },
): ChatMessage[] {
  const remote = mapHistoryToChatMessages(history);
  if (remote.length === 0) {
    return local;
  }

  if (options?.pollOnly) {
    return mergeCurrentTurnFromRemote(local, remote, options.activeTurn);
  }

  const localUser = lastUserMessage(local);
  if (localUser) {
    const anchorMatched =
      options?.activeTurn?.anchorKind === "message_id"
        ? remote.some(
            (msg) =>
              msg.role === "user" && msg.id === options.activeTurn?.anchorId,
          )
        : options?.activeTurn?.anchorKind === "turn_id"
          ? remote.some(
              (msg) =>
                msg.role === "user" &&
                msg.turnId === options.activeTurn?.anchorId,
            )
          : false;
    const localText = localUser.content.trim();
    if (
      anchorMatched ||
      (localText && !remoteHasUserText(remote, localText))
    ) {
      if (anchorMatched || remoteHasDisplayableContent(remote)) {
        return mergeCurrentTurnFromRemote(local, remote, options?.activeTurn);
      }
      return local;
    }
  }

  let merged = appendStreamingPlaceholder(remote, local);

  const localAssistant = latestAssistantTextInTurn(local);
  const remoteAssistant = latestAssistantTextInTurn(merged);
  if (
    localAssistant.length > remoteAssistant.length &&
    (remoteAssistant.length === 0 ||
      localAssistant.startsWith(remoteAssistant))
  ) {
    const userIndex = lastUserIndex(merged);
    for (let i = merged.length - 1; i > userIndex; i -= 1) {
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

export function historyHasDisplayableContent(history: HistoryMessage[]): boolean {
  return turnHasDisplayableContent(mapHistoryToChatMessages(history));
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
