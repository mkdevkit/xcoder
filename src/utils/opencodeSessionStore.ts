import type { HistoryMessage } from "../types/agent";

export type SessionEntry = HistoryMessage;

function entryIndex(entries: SessionEntry[], id: string): number {
  return entries.findIndex((entry) => entry.id === id);
}

function pickLongerAssistantText(
  local: SessionEntry,
  remote: SessionEntry,
): SessionEntry {
  if (local.role !== "assistant" || remote.role !== "assistant") {
    return remote;
  }
  const localText = local.content;
  const remoteText = remote.content;
  if (
    localText.length > remoteText.length &&
    (remoteText.length === 0 || localText.startsWith(remoteText))
  ) {
    return { ...remote, content: localText };
  }
  return remote;
}

function mergeTailByServerOrder(
  localTail: SessionEntry[],
  remoteTail: SessionEntry[],
): SessionEntry[] {
  const localById = new Map(localTail.map((entry) => [entry.id, entry]));
  const merged: SessionEntry[] = [];

  for (const remote of remoteTail) {
    const local = localById.get(remote.id);
    merged.push(local ? pickLongerAssistantText(local, remote) : remote);
    localById.delete(remote.id);
  }

  for (const local of localById.values()) {
    if (local.content.trim() || local.role === "tool") {
      merged.push(local);
    }
  }

  return merged;
}

function mergeFullByServerOrder(
  local: SessionEntry[],
  remoteEntries: SessionEntry[],
): SessionEntry[] {
  const localById = new Map(local.map((entry) => [entry.id, entry]));
  const merged: SessionEntry[] = [];
  const seen = new Set<string>();

  for (const remoteEntry of remoteEntries) {
    seen.add(remoteEntry.id);
    const localEntry = localById.get(remoteEntry.id);
    merged.push(
      localEntry ? pickLongerAssistantText(localEntry, remoteEntry) : remoteEntry,
    );
  }

  for (const localEntry of local) {
    if (!seen.has(localEntry.id) && localEntry.content.trim()) {
      if (localEntry.role === "user") {
        let insertAt = merged.length;
        for (let i = 0; i < merged.length; i += 1) {
          const candidate = merged[i];
          if (
            candidate.role !== "user" &&
            candidate.timestamp >= localEntry.timestamp
          ) {
            insertAt = i;
            break;
          }
        }
        merged.splice(insertAt, 0, localEntry);
      } else {
        merged.push(localEntry);
      }
    }
  }

  return merged;
}

export function syncEntriesFromServer(
  local: SessionEntry[],
  remote: SessionEntry[],
  options?: { anchorUserId?: string | null; full?: boolean },
): SessionEntry[] {
  if (remote.length === 0) return local;

  const anchorUserId = options?.anchorUserId;
  if (options?.full || !anchorUserId) {
    return normalizeTurnAnchorOrder(
      mergeFullByServerOrder(local, remote),
      anchorUserId,
    );
  }

  const localUserIndex = local.findIndex(
    (entry) => entry.role === "user" && entry.id === anchorUserId,
  );
  if (localUserIndex < 0) {
    return normalizeTurnAnchorOrder(
      mergeFullByServerOrder(local, remote),
      anchorUserId,
    );
  }

  const prefix = local.slice(0, localUserIndex + 1);
  const localTail = local.slice(localUserIndex + 1);
  const remoteUserIndex = remote.findIndex(
    (entry) => entry.role === "user" && entry.id === anchorUserId,
  );
  const prefixIds = new Set(prefix.map((entry) => entry.id));
  const remoteTail =
    remoteUserIndex >= 0
      ? remote.slice(remoteUserIndex + 1)
      : remote.filter((entry) => !prefixIds.has(entry.id));

  return normalizeTurnAnchorOrder(
    [...prefix, ...mergeTailByServerOrder(localTail, remoteTail)],
    anchorUserId,
  );
}

export function upsertEntry(
  entries: SessionEntry[],
  entry: SessionEntry,
): SessionEntry[] {
  const index = entryIndex(entries, entry.id);
  if (index < 0) {
    return [...entries, entry];
  }
  const next = [...entries];
  next[index] = { ...next[index], ...entry };
  return next;
}

function formatReasoningContent(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("> ") ? trimmed : `> ${trimmed}`;
}

function mergeReasoningBlock(current: string, incoming: string): string {
  const block = formatReasoningContent(incoming);
  if (!block) return current;
  if (!current.trim()) return block;
  if (current.includes(block)) return current;
  return `${current}\n\n${block}`;
}

function currentTurnStartIndex(
  entries: SessionEntry[],
  anchorUserId?: string | null,
): number {
  if (anchorUserId) {
    const anchored = entries.findIndex(
      (entry) => entry.role === "user" && entry.id === anchorUserId,
    );
    if (anchored >= 0) return anchored;
  }
  return lastUserEntryIndex(entries);
}

/** Keep the active user message before assistant/tool parts for the current turn. */
export function normalizeTurnAnchorOrder(
  entries: SessionEntry[],
  anchorUserId?: string | null,
): SessionEntry[] {
  if (!anchorUserId) return entries;
  const userIndex = entries.findIndex(
    (entry) => entry.role === "user" && entry.id === anchorUserId,
  );
  if (userIndex <= 0) return entries;

  const user = entries[userIndex];
  const before = entries.slice(0, userIndex);
  const after = entries.slice(userIndex + 1);
  const previousUserIndex = lastUserEntryIndex(before);
  if (previousUserIndex < 0) return entries;

  const misplaced = before
    .slice(previousUserIndex + 1)
    .filter(
      (entry) =>
        entry.role !== "user" && entry.timestamp >= user.timestamp,
    );
  if (misplaced.length === 0) return entries;

  const keptBefore = before.slice(0, previousUserIndex + 1);
  const misplacedIds = new Set(misplaced.map((entry) => entry.id));
  const remainingBefore = before
    .slice(previousUserIndex + 1)
    .filter((entry) => !misplacedIds.has(entry.id));

  return [...keptBefore, ...remainingBefore, user, ...misplaced, ...after];
}

export function appendTextDelta(
  entries: SessionEntry[],
  partId: string,
  delta: string,
  anchorUserId?: string | null,
): SessionEntry[] {
  if (!partId || !delta) return entries;
  const turnStart = currentTurnStartIndex(entries, anchorUserId);
  const index = entryIndex(entries, partId);
  if (index >= 0) {
    if (turnStart >= 0 && index <= turnStart) {
      return entries;
    }
    const next = [...entries];
    next[index] = {
      ...next[index],
      content: next[index].content + delta,
    };
    return normalizeTurnAnchorOrder(next, anchorUserId);
  }
  return normalizeTurnAnchorOrder(
    [
      ...entries,
      {
        id: partId,
        role: "assistant",
        content: delta,
        timestamp: Date.now(),
      },
    ],
    anchorUserId,
  );
}

export function setTextSnapshot(
  entries: SessionEntry[],
  partId: string,
  text: string,
  anchorUserId?: string | null,
): SessionEntry[] {
  if (!partId || !text.trim()) return entries;
  return normalizeTurnAnchorOrder(
    upsertEntry(entries, {
      id: partId,
      role: "assistant",
      content: text,
      timestamp: Date.now(),
    }),
    anchorUserId,
  );
}

export function appendReasoningDelta(
  entries: SessionEntry[],
  partId: string,
  delta: string,
  anchorUserId?: string | null,
): SessionEntry[] {
  if (!partId || !delta) return entries;
  const index = entryIndex(entries, partId);
  if (index >= 0) {
    const next = [...entries];
    next[index] = {
      ...next[index],
      content: mergeReasoningBlock(next[index].content, delta),
    };
    return normalizeTurnAnchorOrder(next, anchorUserId);
  }
  return normalizeTurnAnchorOrder(
    [
      ...entries,
      {
        id: partId,
        role: "assistant",
        content: formatReasoningContent(delta),
        timestamp: Date.now(),
      },
    ],
    anchorUserId,
  );
}

export function setReasoningSnapshot(
  entries: SessionEntry[],
  partId: string,
  text: string,
  anchorUserId?: string | null,
): SessionEntry[] {
  if (!partId || !text.trim()) return entries;
  const index = entryIndex(entries, partId);
  const content = formatReasoningContent(text);
  if (index >= 0) {
    const next = [...entries];
    next[index] = { ...next[index], content };
    return normalizeTurnAnchorOrder(next, anchorUserId);
  }
  return normalizeTurnAnchorOrder(
    [
      ...entries,
      {
        id: partId,
        role: "assistant",
        content,
        timestamp: Date.now(),
      },
    ],
    anchorUserId,
  );
}

export function upsertToolEntry(
  entries: SessionEntry[],
  callId: string,
  toolName: string,
  content: string,
  anchorUserId?: string | null,
): SessionEntry[] {
  if (!callId) return entries;
  return normalizeTurnAnchorOrder(
    upsertEntry(entries, {
      id: callId,
      role: "tool",
      content,
      tool_name: toolName,
      timestamp: Date.now(),
    }),
    anchorUserId,
  );
}

export function lastUserEntry(entries: SessionEntry[]): SessionEntry | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.role === "user") {
      return entries[index];
    }
  }
  return undefined;
}

export function lastUserEntryIndex(entries: SessionEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.role === "user") {
      return index;
    }
  }
  return -1;
}
