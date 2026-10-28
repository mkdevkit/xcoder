export const XCODER_PATH_MIME = "application/xcoder-path";
export const XCODER_PATHS_MIME = "application/xcoder-paths";

export function toChatFileReference(
  absolutePath: string,
  rootPath: string | null,
): string {
  if (!rootPath) {
    return `@${absolutePath.replace(/\\/g, "/")}`;
  }

  const normRoot = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
  const normPath = absolutePath.replace(/\\/g, "/");
  const rootLower = normRoot.toLowerCase();
  const pathLower = normPath.toLowerCase();

  if (
    pathLower === rootLower ||
    pathLower.startsWith(`${rootLower}/`)
  ) {
    const relative = normPath.slice(normRoot.length).replace(/^\//, "");
    return `@${relative}`;
  }

  return `@${normPath}`;
}

export function insertTextAtCursor(
  textarea: HTMLTextAreaElement,
  text: string,
  currentValue: string,
): { value: string; cursor: number } {
  const start = textarea.selectionStart ?? currentValue.length;
  const end = textarea.selectionEnd ?? currentValue.length;
  const before = currentValue.slice(0, start);
  const after = currentValue.slice(end);
  const needsSpaceBefore = before.length > 0 && !/\s$/.test(before);
  const needsSpaceAfter = after.length > 0 && !/^\s/.test(after);
  const insert = `${needsSpaceBefore ? " " : ""}${text}${needsSpaceAfter ? " " : ""}`;
  const value = before + insert + after;
  const cursor = before.length + insert.length;
  return { value, cursor };
}

export function formatReferenceForInsert(
  path: string,
  rootPath: string | null,
): string {
  if (path.startsWith("@")) return path;
  return toChatFileReference(path, rootPath);
}

export function referenceDisplayName(reference: string): string {
  const path = reference.startsWith("@") ? reference.slice(1) : reference;
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function normalizeDroppedReferences(
  paths: string[],
  rootPath: string | null,
): string[] {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const path of paths) {
    const ref = formatReferenceForInsert(path, rootPath);
    if (seen.has(ref)) continue;
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

export function isInternalPathDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(XCODER_PATH_MIME);
}

export function pathsFromDataTransfer(dataTransfer: DataTransfer): string[] {
  const multi = dataTransfer.getData(XCODER_PATHS_MIME);
  if (multi) {
    try {
      const parsed = JSON.parse(multi) as unknown;
      if (Array.isArray(parsed)) {
        const paths = parsed.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0,
        );
        if (paths.length > 0) return paths;
      }
    } catch {
      // fall through to single-path payload
    }
  }

  const custom = dataTransfer.getData(XCODER_PATH_MIME);
  if (custom) {
    return [custom];
  }

  const plain = dataTransfer.getData("text/plain").trim();
  if (!plain) return [];
  if (plain.startsWith("@")) return [plain];
  if (plain.includes("/") || plain.includes("\\")) {
    return [plain];
  }

  return [];
}

export function pathsFromFileList(files: FileList | File[]): string[] {
  return Array.from(files)
    .map((file) => {
      const withPath = file as File & { path?: string };
      return withPath.path?.trim() || file.name.trim();
    })
    .filter((path) => path.length > 0);
}

export function pointInDropArea(
  rect: DOMRect,
  physicalX: number,
  physicalY: number,
): boolean {
  const scale = window.devicePixelRatio || 1;
  const x = physicalX / scale;
  const y = physicalY / scale;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function startExplorerDrag(
  event: React.DragEvent,
  absolutePaths: string[],
  rootPath: string | null,
) {
  const paths = absolutePaths.filter((path) => path.trim().length > 0);
  if (paths.length === 0) return;

  event.stopPropagation();
  const references = paths.map((path) => toChatFileReference(path, rootPath));
  event.dataTransfer.clearData();
  event.dataTransfer.setData(XCODER_PATH_MIME, paths[0]);
  event.dataTransfer.setData(XCODER_PATHS_MIME, JSON.stringify(paths));
  event.dataTransfer.setData("text/plain", references.join(" "));
  // Explorer drops use move; chat input attaches a copy of the file reference.
  event.dataTransfer.effectAllowed = "copyMove";
}

/** @deprecated Use startExplorerDrag */
export function startFileDrag(
  event: React.DragEvent,
  absolutePath: string,
  rootPath: string | null,
) {
  startExplorerDrag(event, [absolutePath], rootPath);
}
