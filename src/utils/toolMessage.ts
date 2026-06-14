const PREVIEW_MAX = 100;

function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export function formatToolContent(args: unknown): string {
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

export function getToolPreview(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "（无输出）";

  try {
    const data = JSON.parse(trimmed) as Record<string, unknown>;
    const parts: string[] = [];

    const status =
      data.status ??
      (typeof data.state === "object" && data.state !== null
        ? (data.state as Record<string, unknown>).status
        : data.state);
    if (status) parts.push(String(status));

    if (data.title) parts.push(String(data.title));
    if (data.tool) parts.push(String(data.tool));

    const input = data.input ?? data.arguments ?? data.args;
    if (input) {
      parts.push(truncate(formatToolContent(input).replace(/\s+/g, " "), 60));
    }

    const output =
      data.output ??
      (typeof data.state === "object" && data.state !== null
        ? (data.state as Record<string, unknown>).output
        : undefined);
    if (output) {
      parts.push(truncate(String(output).replace(/\s+/g, " "), 80));
    }

    if (parts.length > 0) return parts.join(" · ");
  } catch {
    // fall through to plain text preview
  }

  return truncate(trimmed.replace(/\s+/g, " "), PREVIEW_MAX);
}
