import type { DragEvent } from "react";
import { joinPath } from "./path";
import {
  isInternalPathDrag,
  pathsFromDataTransfer,
  pathsFromFileList,
  XCODER_PATH_MIME,
} from "./chatFileReference";

export { isInternalPathDrag };

export function extractDroppedPaths(event: DragEvent): string[] {
  const transfer = event.dataTransfer;
  if (!transfer) return [];

  const fromTransfer = pathsFromDataTransfer(transfer);
  if (fromTransfer.length > 0) {
    return fromTransfer;
  }
  return pathsFromFileList(transfer.files);
}

export function hasExternalFilePayload(dataTransfer: DataTransfer): boolean {
  if (dataTransfer.types.includes(XCODER_PATH_MIME)) {
    return true;
  }
  if (dataTransfer.types.includes("Files")) {
    return true;
  }
  return dataTransfer.files.length > 0;
}

export function resolveDroppedOpenPath(
  rawPath: string,
  rootPath: string | null,
): string {
  const trimmed = rawPath.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("@")) {
    const inner = trimmed.slice(1);
    if (rootPath && !/^[a-zA-Z]:[\\/]/.test(inner) && !inner.startsWith("/")) {
      return joinPath(rootPath, inner);
    }
    return inner;
  }
  return trimmed;
}

export function isAbsoluteFilesystemPath(path: string): boolean {
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(path);
}
