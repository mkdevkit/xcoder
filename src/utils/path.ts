export function parentPath(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  const index = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );
  if (index <= 0) return normalized;
  return normalized.slice(0, index);
}

export function workspacesMatch(left: string, right: string) {
  const normalize = (value: string) =>
    value.replace(/[\\/]+$/, "").replace(/\//g, "\\").toLowerCase();
  return normalize(left) === normalize(right);
}

export function joinPath(parent: string, name: string) {
  const separator = parent.includes("\\") ? "\\" : "/";
  return `${parent.replace(/[\\/]+$/, "")}${separator}${name}`;
}

export function resolveFilePathInWorkspace(
  rawPath: string,
  rootPath: string | null,
): string {
  const trimmed = rawPath.trim();
  if (!trimmed) return trimmed;
  const isAbsolute =
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith("\\\\") ||
    trimmed.startsWith("/");
  if (isAbsolute || !rootPath) return trimmed;
  return joinPath(rootPath, trimmed.replace(/^\.[\\/]/, ""));
}
