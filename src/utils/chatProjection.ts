import type { ChatMessage, HistoryMessage } from "../types/agent";
import { normalizePlanningMessageOrder, stabilizeTurnErrorOrder } from "./chatHistory";
import { isToolRunning } from "./toolMessage";

export function isSyntheticUserContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (
    trimmed === "The following tool was executed by the user" ||
    trimmed === "What did we do so far?" ||
    trimmed.startsWith("Attached media from tool result:")
  ) {
    return true;
  }
  return false;
}

export function isSyntheticUserEntry(entry: Pick<HistoryMessage, "role" | "content">): boolean {
  return entry.role === "user" && isSyntheticUserContent(entry.content);
}

export function mapEntryToChatMessage(entry: HistoryMessage): ChatMessage {
  return {
    id: entry.id,
    role: entry.role as ChatMessage["role"],
    content: entry.content,
    timestamp: entry.timestamp || Date.now(),
    toolName: entry.tool_name,
    turnId: entry.turn_id,
  };
}

export function projectEntriesToChatMessages(
  entries?: HistoryMessage[] | null,
): ChatMessage[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }
  const normalized = entries
    .map((entry) => normalizeStoredEntry(entry))
    .filter((entry): entry is HistoryMessage => entry !== null)
    .filter((entry) => !isSyntheticUserEntry(entry));
  return normalizePlanningMessageOrder(
    stabilizeTurnErrorOrder(normalized).map(mapEntryToChatMessage),
  );
}

function normalizeStoredEntry(entry: HistoryMessage): HistoryMessage | null {
  if (!entry?.id) return null;
  const legacy = entry as HistoryMessage & {
    toolName?: string;
    turnId?: string;
  };
  return {
    id: entry.id,
    role: entry.role,
    content: entry.content ?? "",
    timestamp: entry.timestamp || Date.now(),
    tool_name: entry.tool_name ?? legacy.toolName,
    turn_id: entry.turn_id ?? legacy.turnId,
  };
}

export function turnHasDisplayableEntries(entries: HistoryMessage[]): boolean {
  const lastUserIndex = lastUserEntryIndex(entries);
  for (let index = entries.length - 1; index > lastUserIndex; index -= 1) {
    const entry = entries[index];
    if (!entry) continue;
    if (entry.role === "tool") return true;
    if (entry.role === "assistant" && entry.content.trim()) return true;
  }
  return false;
}

export function lastUserEntryIndex(entries: HistoryMessage[]): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.role === "user") {
      return index;
    }
  }
  return -1;
}

export function currentTurnHasRunningTools(
  entries: HistoryMessage[],
): boolean {
  const lastUserIndex = lastUserEntryIndex(entries);
  for (let index = entries.length - 1; index > lastUserIndex; index -= 1) {
    const entry = entries[index];
    if (entry?.role === "tool" && isToolRunning(entry.content)) {
      return true;
    }
  }
  return false;
}

export function currentChatTurnHasRunningTools(
  messages: ChatMessage[],
): boolean {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  for (let index = messages.length - 1; index > lastUserIndex; index -= 1) {
    const message = messages[index];
    if (message?.role === "tool" && isToolRunning(message.content)) {
      return true;
    }
  }
  return false;
}

/** True when a follow-up full sync did not add or grow turn entries. */
export function isTurnHistoryStable(
  before: HistoryMessage[],
  after: HistoryMessage[],
): boolean {
  if (after.length > before.length) return false;
  const beforeById = new Map(before.map((entry) => [entry.id, entry]));
  for (const entry of after) {
    const previous = beforeById.get(entry.id);
    if (!previous) return false;
    if (
      entry.role === "assistant" &&
      entry.content.length > previous.content.length
    ) {
      return false;
    }
    if (entry.role === "tool" && entry.content !== previous.content) {
      return false;
    }
  }
  return true;
}

/** Local turn tail still has entries the latest authoritative sync dropped. */
export function hasUnsyncedLocalTurnTail(
  localBefore: HistoryMessage[],
  syncedAfter: HistoryMessage[],
): boolean {
  const userIndex = lastUserEntryIndex(localBefore);
  const syncedIds = new Set(syncedAfter.map((entry) => entry.id));
  for (let index = userIndex + 1; index < localBefore.length; index += 1) {
    const entry = localBefore[index];
    if (!entry || syncedIds.has(entry.id)) continue;
    if (entry.role === "tool" || entry.content.trim()) {
      return true;
    }
  }
  return false;
}

export function finalizeTurnEntries(entries: HistoryMessage[]): HistoryMessage[] {
  const result = [...entries];
  while (result.length > 0) {
    const last = result[result.length - 1];
    if (last.role === "assistant" && !last.content.trim()) {
      result.pop();
    } else {
      break;
    }
  }
  return result;
}

export function sessionTitleFromEntries(
  entries: HistoryMessage[],
  fallback: string,
): string {
  for (const entry of entries) {
    if (entry.role === "user" && entry.content.trim()) {
      const line = entry.content.trim().split(/\r?\n/)[0]?.trim() ?? "";
      if (line) {
        return line.length > 48 ? `${line.slice(0, 48)}…` : line;
      }
    }
  }
  return fallback;
}

export function historyHasDisplayableEntries(history: HistoryMessage[]): boolean {
  return turnHasDisplayableEntries(history);
}
