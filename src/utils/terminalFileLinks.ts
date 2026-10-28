export interface ParsedFileLink {
  filePath: string;
  line?: number;
  column?: number;
}

const LINE_PATTERNS: RegExp[] = [
  /[A-Za-z]:[\\/][^\s:'"<>|]+?\.[A-Za-z0-9]{1,16}(?::\d+)(?::\d+)?/g,
  /[A-Za-z]:[\\/][^\s:'"<>|]+?\.[A-Za-z0-9]{1,16}/g,
  /(?:~[\\/]|\.{1,2}[\\/])[^\s:'"<>|]+?\.[A-Za-z0-9]{1,16}(?::\d+)(?::\d+)?/g,
  /(?:~[\\/]|\.{1,2}[\\/])[^\s:'"<>|]+?\.[A-Za-z0-9]{1,16}/g,
  /(?:[\w.-]+[\\/])+[\w.-]+\.[A-Za-z0-9]{1,16}(?::\d+)(?::\d+)?/g,
  /(?:[\w.-]+[\\/])+[\w.-]+\.[A-Za-z0-9]{1,16}/g,
  /[\w./\\-]+\.[A-Za-z0-9]{1,16}\(\d+(?:,\s*\d+)?\)/g,
];

export function parseFileLinkText(text: string): ParsedFileLink | null {
  const trimmed = text.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) {
    return null;
  }

  const parenMatch = trimmed.match(/^(.+?)\((\d+)(?:,\s*(\d+))?\)$/);
  if (parenMatch) {
    return {
      filePath: parenMatch[1],
      line: Number(parenMatch[2]),
      column: parenMatch[3] ? Number(parenMatch[3]) : undefined,
    };
  }

  const colonMatch = trimmed.match(/^(.+?):(\d+)(?::(\d+))?$/);
  if (colonMatch && looksLikeFilePath(colonMatch[1])) {
    return {
      filePath: colonMatch[1],
      line: Number(colonMatch[2]),
      column: colonMatch[3] ? Number(colonMatch[3]) : undefined,
    };
  }

  if (looksLikeFilePath(trimmed)) {
    return { filePath: trimmed };
  }

  return null;
}

function looksLikeFilePath(path: string): boolean {
  return (
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.startsWith("~/") ||
    path.startsWith("~\\") ||
    path.startsWith("./") ||
    path.startsWith(".\\") ||
    path.startsWith("../") ||
    path.startsWith("..\\") ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /\.[A-Za-z0-9]{1,16}$/.test(path)
  );
}

function joinPath(base: string, relative: string): string {
  const sep = base.includes("\\") ? "\\" : "/";
  const normalized = relative.replace(/^[./\\]+/, "");
  return `${base.replace(/[\\/]+$/, "")}${sep}${normalized.replace(/\//g, sep)}`;
}

export async function resolveTerminalFilePath(
  rawPath: string,
  workspaceRoot: string | null,
  readFile: (path: string) => Promise<unknown>,
): Promise<string | null> {
  const path = rawPath.trim().replace(/^["']|["']$/g, "");
  const candidates = new Set<string>([path]);

  if (workspaceRoot) {
    candidates.add(joinPath(workspaceRoot, path));
    candidates.add(joinPath(workspaceRoot, path.replace(/^\.[\\/]/, "")));
  }

  for (const candidate of candidates) {
    try {
      await readFile(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }

  return null;
}

export function findFileLinksInLine(lineText: string): Array<{
  text: string;
  startIndex: number;
  parsed: ParsedFileLink;
}> {
  const occupied: Array<{ start: number; end: number }> = [];
  const results: Array<{
    text: string;
    startIndex: number;
    parsed: ParsedFileLink;
  }> = [];

  for (const pattern of LINE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of lineText.matchAll(pattern)) {
      const text = match[0];
      const startIndex = match.index;
      if (startIndex === undefined) continue;

      const endIndex = startIndex + text.length;
      const overlaps = occupied.some(
        (range) => startIndex < range.end && endIndex > range.start,
      );
      if (overlaps) continue;

      const parsed = parseFileLinkText(text);
      if (!parsed) continue;

      occupied.push({ start: startIndex, end: endIndex });
      results.push({ text, startIndex, parsed });
    }
  }

  return results.sort((a, b) => a.startIndex - b.startIndex);
}
