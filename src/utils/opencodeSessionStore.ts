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
      merged.push(localEntry);
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
    return mergeFullByServerOrder(local, remote);
  }

  const localUserIndex = local.findIndex(
    (entry) => entry.role === "user" && entry.id === anchorUserId,
  );
  if (localUserIndex < 0) {
    return mergeFullByServerOrder(local, remote);
  }

  const prefix = local.slice(0, localUserIndex + 1);
  const localTail = local.slice(localUserIndex + 1);
  const remoteUserIndex = remote.findIndex(
    (entry) => entry.role === "user" && entry.id === anchorUserId,
  );
  const remoteTail =
    remoteUserIndex >= 0 ? remote.slice(remoteUserIndex + 1) : remote;

  return [...prefix, ...mergeTailByServerOrder(localTail, remoteTail)];
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

export function appendTextDelta(
  entries: SessionEntry[],
  partId: string,
  delta: string,
): SessionEntry[] {
  if (!partId || !delta) return entries;
  const index = entryIndex(entries, partId);
  if (index >= 0) {
    const next = [...entries];
    next[index] = {
      ...next[index],
      content: next[index].content + delta,
    };
    return next;
  }
  return [
    ...entries,
    {
      id: partId,
      role: "assistant",
      content: delta,
      timestamp: Date.now(),
    },
  ];
}

export function setTextSnapshot(
  entries: SessionEntry[],
  partId: string,
  text: string,
): SessionEntry[] {
  if (!partId || !text.trim()) return entries;
  return upsertEntry(entries, {
    id: partId,
    role: "assistant",
    content: text,
    timestamp: Date.now(),
  });
}

export function appendReasoningDelta(
  entries: SessionEntry[],
  partId: string,
  delta: string,
): SessionEntry[] {
  if (!partId || !delta) return entries;
  const index = entryIndex(entries, partId);
  if (index >= 0) {
    const next = [...entries];
    next[index] = {
      ...next[index],
      content: mergeReasoningBlock(next[index].content, delta),
    };
    return next;
  }
  return [
    ...entries,
    {
      id: partId,
      role: "assistant",
      content: formatReasoningContent(delta),
      timestamp: Date.now(),
    },
  ];
}

export function setReasoningSnapshot(
  entries: SessionEntry[],
  partId: string,
  text: string,
): SessionEntry[] {
  if (!partId || !text.trim()) return entries;
  const index = entryIndex(entries, partId);
  const content = formatReasoningContent(text);
  if (index >= 0) {
    const next = [...entries];
    next[index] = { ...next[index], content };
    return next;
  }
  return [
    ...entries,
    {
      id: partId,
      role: "assistant",
      content,
      timestamp: Date.now(),
    },
  ];
}

export function upsertToolEntry(
  entries: SessionEntry[],
  callId: string,
  toolName: string,
  content: string,
): SessionEntry[] {
  if (!callId) return entries;
  return upsertEntry(entries, {
    id: callId,
    role: "tool",
    content,
    tool_name: toolName,
    timestamp: Date.now(),
  });
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
