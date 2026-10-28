import type { ChatMessage } from "../types/agent";
import { isSyntheticUserContent } from "./chatProjection";

export type TurnInlinePart =
  | { type: "text"; id: string; content: string }
  | { type: "tools"; id: string; tools: ChatMessage[] };

export interface AssistantMessageGroup {
  messageId: string;
  parts: TurnInlinePart[];
}

export interface ChatTurn {
  id: string;
  user?: ChatMessage;
  assistantGroups: AssistantMessageGroup[];
  /** @deprecated Use assistantGroups. Kept for transitional references. */
  inlineParts: TurnInlinePart[];
  isLast: boolean;
}

function dedupeTools(tools: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  const result: ChatMessage[] = [];
  for (const tool of tools) {
    if (seen.has(tool.id)) continue;
    seen.add(tool.id);
    result.push(tool);
  }
  return result;
}

function flushToolBuffer(buffer: ChatMessage[], parts: TurnInlinePart[]) {
  if (buffer.length === 0) return;
  const tools = dedupeTools(buffer);
  parts.push({
    type: "tools",
    id: tools[0]?.id ?? `tools-${parts.length}`,
    tools,
  });
  buffer.length = 0;
}

function buildInlineParts(turnMessages: ChatMessage[]): TurnInlinePart[] {
  const parts: TurnInlinePart[] = [];
  const toolBuffer: ChatMessage[] = [];

  for (const message of turnMessages) {
    if (message.role === "tool") {
      toolBuffer.push(message);
      continue;
    }

    if (message.role === "assistant") {
      flushToolBuffer(toolBuffer, parts);
      parts.push({
        type: "text",
        id: message.id,
        content: message.content,
      });
    }
  }

  flushToolBuffer(toolBuffer, parts);
  return pruneEmptyTextParts(parts);
}

function pruneEmptyTextParts(parts: TurnInlinePart[]): TurnInlinePart[] {
  let lastTextIndex = -1;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (parts[i].type === "text") {
      lastTextIndex = i;
      break;
    }
  }
  if (lastTextIndex < 0) return parts;

  return parts.filter((part, index) => {
    if (part.type !== "text") return true;
    if (part.content.trim()) return true;
    return index === lastTextIndex;
  });
}

function messageGroupKey(
  message: ChatMessage,
  fallbackKey: string | null,
  allowFallback: boolean,
): string {
  if (message.turnId) return message.turnId;
  if (allowFallback && fallbackKey) return fallbackKey;
  return `part:${message.id}`;
}

function splitTailByParentMessage(tail: ChatMessage[]): ChatMessage[][] {
  if (tail.length === 0) return [];

  const hasParentMessageIds = tail.some((message) => Boolean(message.turnId));
  const allowFallback = !hasParentMessageIds;

  const groups: ChatMessage[][] = [];
  let current: ChatMessage[] = [];
  let currentKey: string | null = null;

  for (const message of tail) {
    const key = messageGroupKey(message, currentKey, allowFallback);
    if (currentKey !== null && key !== currentKey) {
      groups.push(current);
      current = [];
    }
    currentKey = key;
    current.push(message);
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

/** Keep parts of the same OpenCode message together and ordered by first appearance. */
export function stabilizeTailByParentMessage(tail: ChatMessage[]): ChatMessage[] {
  if (tail.length <= 1) return tail;

  const hasTurnIds = tail.some((message) => Boolean(message.turnId));
  if (!hasTurnIds) return tail;

  const originalIndex = new Map(tail.map((message, index) => [message.id, index]));
  const turnIdFirstIndex = new Map<string, number>();

  tail.forEach((message, index) => {
    if (!message.turnId || turnIdFirstIndex.has(message.turnId)) return;
    turnIdFirstIndex.set(message.turnId, index);
  });

  return [...tail].sort((left, right) => {
    const leftGroup = left.turnId
      ? (turnIdFirstIndex.get(left.turnId) ?? Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER;
    const rightGroup = right.turnId
      ? (turnIdFirstIndex.get(right.turnId) ?? Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER;
    if (leftGroup !== rightGroup) return leftGroup - rightGroup;
    return (
      (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0)
    );
  });
}

function buildAssistantGroups(tail: ChatMessage[]): AssistantMessageGroup[] {
  const orderedTail = stabilizeTailByParentMessage(tail);
  const groups = splitTailByParentMessage(orderedTail);
  return groups
    .map((group, index) => ({
      group,
      index,
      order: groupOrderKey(group, tail),
    }))
    .sort(
      (left, right) =>
        left.order - right.order || left.index - right.index,
    )
    .map(({ group }) => ({
      messageId: messageGroupKey(group[0], null, false),
      parts: buildInlineParts(group),
    }))
    .filter((group) => turnHasAssistantBody(group.parts));
}

function groupOrderKey(group: ChatMessage[], tail: ChatMessage[]): number {
  const originalIndex = new Map(tail.map((message, index) => [message.id, index]));
  let minIndex = Number.MAX_SAFE_INTEGER;
  for (const message of group) {
    const index = originalIndex.get(message.id);
    if (index !== undefined && index < minIndex) {
      minIndex = index;
    }
  }
  return minIndex;
}

export function isSyntheticUserMessage(message: ChatMessage): boolean {
  return message.role === "user" && isSyntheticUserContent(message.content);
}

export function buildChatTurns(messages: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let currentUser: ChatMessage | undefined;
  let currentTail: ChatMessage[] = [];

  const pushTurn = (isLast: boolean) => {
    const assistantGroups = buildAssistantGroups(currentTail);
    const inlineParts = assistantGroups.flatMap((group) => group.parts);
    if (!currentUser && inlineParts.length === 0) return;
    turns.push({
      id: currentUser?.id ?? inlineParts[0]?.id ?? `turn-${turns.length}`,
      user: currentUser,
      assistantGroups,
      inlineParts,
      isLast,
    });
  };

  for (const message of messages) {
    if (message.role === "user") {
      if (isSyntheticUserMessage(message)) {
        continue;
      }
      pushTurn(false);
      currentUser = message;
      currentTail = [];
      continue;
    }
    currentTail.push(message);
  }

  pushTurn(true);
  if (turns.length > 0) {
    turns.forEach((turn, index) => {
      turn.isLast = index === turns.length - 1;
    });
  }

  return turns;
}

export function turnHasAssistantBody(parts: TurnInlinePart[]): boolean {
  return parts.some(
    (part) =>
      part.type === "tools" ||
      (part.type === "text" && part.content.trim().length > 0),
  );
}

export function isLastTextPart(
  parts: TurnInlinePart[],
  partIndex: number,
): boolean {
  for (let i = partIndex + 1; i < parts.length; i += 1) {
    if (parts[i].type === "text") return false;
  }
  return true;
}
