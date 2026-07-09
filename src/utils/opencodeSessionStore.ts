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

function mergeRemoteAuthoritative(
  local: SessionEntry[],
  remoteEntries: SessionEntry[],
): SessionEntry[] {
  if (remoteEntries.length === 0) return local;
  const localById = new Map(local.map((entry) => [entry.id, entry]));
  return remoteEntries.map((remoteEntry) => {
    const localEntry = localById.get(remoteEntry.id);
    return localEntry
      ? pickLongerAssistantText(localEntry, remoteEntry)
      : remoteEntry;
  });
}

function normalizeWithAnchor(
  entries: SessionEntry[],
  anchorUserId?: string | null,
  baselineEntryIds?: readonly string[] | null,
): SessionEntry[] {
  return normalizeTurnAnchorOrder(entries, anchorUserId, baselineEntryIds);
}

export function syncEntriesFromServer(
  local: SessionEntry[],
  remote: SessionEntry[],
  options?: {
    anchorUserId?: string | null;
    baselineEntryIds?: readonly string[] | null;
    full?: boolean;
  },
): SessionEntry[] {
  if (remote.length === 0) return local;

  const anchorUserId = options?.anchorUserId;
  const baselineEntryIds = options?.baselineEntryIds;
  if (options?.full || !anchorUserId) {
    return mergeRemoteAuthoritative(local, remote);
  }

  const localUserIndex = local.findIndex(
    (entry) => entry.role === "user" && entry.id === anchorUserId,
  );
  if (localUserIndex < 0) {
    return mergeRemoteAuthoritative(local, remote);
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

  return normalizeWithAnchor(
    [...prefix, ...mergeTailByServerOrder(localTail, remoteTail)],
    anchorUserId,
    baselineEntryIds,
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
  next[index] = {
    ...next[index],
    ...entry,
    turn_id: entry.turn_id ?? next[index].turn_id,
  };
  return next;
}

function withParentMessageId(
  entry: SessionEntry,
  parentMessageId?: string | null,
): SessionEntry {
  if (!parentMessageId || entry.turn_id) return entry;
  return { ...entry, turn_id: parentMessageId };
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
  baselineEntryIds?: readonly string[] | null,
): SessionEntry[] {
  if (!anchorUserId || !baselineEntryIds?.length) return entries;

  const userIndex = entries.findIndex(
    (entry) => entry.role === "user" && entry.id === anchorUserId,
  );
  if (userIndex < 0) return entries;

  const user = entries[userIndex];
  const baseline = new Set(baselineEntryIds);
  const previousUserIndex = lastUserEntryIndex(entries.slice(0, userIndex));
  const turnStart = previousUserIndex + 1;

  const head = entries.slice(0, turnStart);
  const middle = entries.slice(turnStart, userIndex);
  const tail = entries.slice(userIndex + 1);

  const settled = middle.filter((entry) => baseline.has(entry.id));
  const incoming = middle.filter(
    (entry) => entry.role !== "user" && !baseline.has(entry.id),
  );

  if (incoming.length === 0 && middle.length === settled.length) {
    return entries;
  }

  return [...head, ...settled, user, ...incoming, ...tail];
}

function anchorUserText(
  entries: SessionEntry[],
  anchorUserId?: string | null,
): string | null {
  if (!anchorUserId) return null;
  const entry = entries.find(
    (item) => item.role === "user" && item.id === anchorUserId,
  );
  const text = entry?.content.trim();
  return text || null;
}

function stripUserEchoText(text: string, userText: string | null): string {
  if (!userText || !text) return text;
  if (text === userText) return "";
  if (text.startsWith(userText)) {
    return text.slice(userText.length).replace(/^\s+/, "");
  }
  return text;
}

export function appendTextDelta(
  entries: SessionEntry[],
  partId: string,
  delta: string,
  anchorUserId?: string | null,
  baselineEntryIds?: readonly string[] | null,
  parentMessageId?: string | null,
): SessionEntry[] {
  const cleanedDelta = stripUserEchoText(delta, anchorUserText(entries, anchorUserId));
  if (!partId || !cleanedDelta) return entries;
  const turnStart = currentTurnStartIndex(entries, anchorUserId);
  const index = entryIndex(entries, partId);
  if (index >= 0) {
    if (turnStart >= 0 && index <= turnStart) {
      return entries;
    }
    const next = [...entries];
    next[index] = withParentMessageId(
      {
        ...next[index],
        content: stripUserEchoText(
          next[index].content + cleanedDelta,
          anchorUserText(entries, anchorUserId),
        ),
      },
      parentMessageId,
    );
    if (!next[index].content) {
      return normalizeWithAnchor(
        next.filter((_, entryIndex) => entryIndex !== index),
        anchorUserId,
        baselineEntryIds,
      );
    }
    return normalizeWithAnchor(next, anchorUserId, baselineEntryIds);
  }
  return normalizeWithAnchor(
    [
      ...entries,
      withParentMessageId(
        {
          id: partId,
          role: "assistant",
          content: cleanedDelta,
          timestamp: Date.now(),
        },
        parentMessageId,
      ),
    ],
    anchorUserId,
    baselineEntryIds,
  );
}

export function setTextSnapshot(
  entries: SessionEntry[],
  partId: string,
  text: string,
  anchorUserId?: string | null,
  baselineEntryIds?: readonly string[] | null,
  parentMessageId?: string | null,
): SessionEntry[] {
  const cleanedText = stripUserEchoText(
    text,
    anchorUserText(entries, anchorUserId),
  );
  if (!partId || !cleanedText.trim()) return entries;
  return normalizeWithAnchor(
    upsertEntry(
      entries,
      withParentMessageId(
        {
          id: partId,
          role: "assistant",
          content: cleanedText,
          timestamp: Date.now(),
        },
        parentMessageId,
      ),
    ),
    anchorUserId,
    baselineEntryIds,
  );
}

export function appendReasoningDelta(
  entries: SessionEntry[],
  partId: string,
  delta: string,
  anchorUserId?: string | null,
  baselineEntryIds?: readonly string[] | null,
  parentMessageId?: string | null,
): SessionEntry[] {
  if (!partId || !delta) return entries;
  const index = entryIndex(entries, partId);
  if (index >= 0) {
    const next = [...entries];
    next[index] = withParentMessageId(
      {
        ...next[index],
        content: mergeReasoningBlock(next[index].content, delta),
      },
      parentMessageId,
    );
    return normalizeWithAnchor(next, anchorUserId, baselineEntryIds);
  }
  return normalizeWithAnchor(
    [
      ...entries,
      withParentMessageId(
        {
          id: partId,
          role: "assistant",
          content: formatReasoningContent(delta),
          timestamp: Date.now(),
        },
        parentMessageId,
      ),
    ],
    anchorUserId,
    baselineEntryIds,
  );
}

export function setReasoningSnapshot(
  entries: SessionEntry[],
  partId: string,
  text: string,
  anchorUserId?: string | null,
  baselineEntryIds?: readonly string[] | null,
  parentMessageId?: string | null,
): SessionEntry[] {
  if (!partId || !text.trim()) return entries;
  const index = entryIndex(entries, partId);
  const content = formatReasoningContent(text);
  if (index >= 0) {
    const next = [...entries];
    next[index] = withParentMessageId({ ...next[index], content }, parentMessageId);
    return normalizeWithAnchor(next, anchorUserId, baselineEntryIds);
  }
  return normalizeWithAnchor(
    [
      ...entries,
      withParentMessageId(
        {
          id: partId,
          role: "assistant",
          content,
          timestamp: Date.now(),
        },
        parentMessageId,
      ),
    ],
    anchorUserId,
    baselineEntryIds,
  );
}

export function upsertToolEntry(
  entries: SessionEntry[],
  callId: string,
  toolName: string,
  content: string,
  anchorUserId?: string | null,
  baselineEntryIds?: readonly string[] | null,
  parentMessageId?: string | null,
): SessionEntry[] {
  if (!callId) return entries;
  return normalizeWithAnchor(
    upsertEntry(
      entries,
      withParentMessageId(
        {
          id: callId,
          role: "tool",
          content,
          tool_name: toolName,
          timestamp: Date.now(),
        },
        parentMessageId,
      ),
    ),
    anchorUserId,
    baselineEntryIds,
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
