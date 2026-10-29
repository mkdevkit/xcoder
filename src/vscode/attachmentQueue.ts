const pending: string[] = [];

export function queueAttachmentPaths(paths: string[]) {
  const valid = paths.filter(
    (path) => typeof path === "string" && path.trim().length > 0,
  );
  if (valid.length === 0) return;
  pending.push(...valid);
  window.dispatchEvent(new Event("xcoder:attachments-queued"));
}

export function takeAttachmentPaths(): string[] {
  return pending.splice(0, pending.length);
}
