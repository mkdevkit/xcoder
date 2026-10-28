export function threadStorageKey(providerId: string, workspace: string) {
  return `xcoder:thread:${providerId}:${workspace}`;
}

export function readSavedThreadId(providerId: string, workspace: string) {
  try {
    return localStorage.getItem(threadStorageKey(providerId, workspace));
  } catch {
    return null;
  }
}

export function writeSavedThreadId(
  providerId: string,
  workspace: string,
  threadId: string,
) {
  try {
    localStorage.setItem(threadStorageKey(providerId, workspace), threadId);
  } catch {
    // ignore storage failures
  }
}

export function clearSavedThreadId(providerId: string, workspace: string) {
  try {
    localStorage.removeItem(threadStorageKey(providerId, workspace));
  } catch {
    // ignore storage failures
  }
}
