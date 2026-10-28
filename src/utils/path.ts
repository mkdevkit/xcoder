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

export function relativePathFromRoot(rootPath: string, targetPath: string): string {
  const normalize = (value: string) =>
    value.replace(/[\\/]+$/, "").replace(/\\/g, "/");
  const root = normalize(rootPath);
  const target = normalize(targetPath);
  const rootLower = root.toLowerCase();
  const targetLower = target.toLowerCase();
  if (targetLower === rootLower) {
    return "";
  }
  const prefix = `${rootLower}/`;
  if (targetLower.startsWith(prefix)) {
    return target.slice(root.length + 1);
  }
  return target;
}

export function folderIncludePattern(rootPath: string, folderPath: string): string {
  const relative = relativePathFromRoot(rootPath, folderPath);
  if (!relative) {
    return "**";
  }
  return `${relative}/**`;
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
