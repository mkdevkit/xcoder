import type { ChatMessage } from "../types/agent";

export type TurnInlinePart =
  | { type: "text"; id: string; content: string }
  | { type: "tools"; id: string; tools: ChatMessage[] };

export interface ChatTurn {
  id: string;
  user?: ChatMessage;
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

export function buildChatTurns(messages: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let currentUser: ChatMessage | undefined;
  let currentTail: ChatMessage[] = [];

  const pushTurn = (isLast: boolean) => {
    if (!currentUser && currentTail.length === 0) return;
    turns.push({
      id: currentUser?.id ?? currentTail[0]?.id ?? `turn-${turns.length}`,
      user: currentUser,
      inlineParts: buildInlineParts(currentTail),
      isLast,
    });
  };

  for (const message of messages) {
    if (message.role === "user") {
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
