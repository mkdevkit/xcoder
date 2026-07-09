import type { ChatMessage, HistoryMessage } from "../types/agent";
import { normalizePlanningMessageOrder } from "./chatHistory";

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
    .filter((entry): entry is HistoryMessage => entry !== null);
  return normalizePlanningMessageOrder(normalized.map(mapEntryToChatMessage));
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
