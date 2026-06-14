import { useCallback, useRef, useState } from "react";
import {
  normalizeDroppedReferences,
  pathsFromDataTransfer,
  pathsFromFileList,
} from "../utils/chatFileReference";

interface UseChatInputDropOptions {
  rootPath: string | null;
  onAttach: (references: string[]) => void;
  disabled?: boolean;
  onFocus?: () => void;
}

export function useChatInputDrop({
  rootPath,
  onAttach,
  disabled,
  onFocus,
}: UseChatInputDropOptions) {
  const dropAreaRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const attachPaths = useCallback(
    (paths: string[]) => {
      if (disabled || paths.length === 0) return;
      const refs = normalizeDroppedReferences(paths, rootPath);
      if (refs.length === 0) return;
      onFocus?.();
      onAttach(refs);
    },
    [disabled, onAttach, onFocus, rootPath],
  );

  const allowDrop = useCallback(
    (event: React.DragEvent) => {
      if (disabled) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    },
    [disabled],
  );

  const handleDragEnter = allowDrop;
  const handleDragOver = allowDrop;

  const handleDragLeave = (event: React.DragEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setDragOver(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    if (disabled) return;

    const fromTransfer = pathsFromDataTransfer(event.dataTransfer);
    if (fromTransfer.length > 0) {
      attachPaths(fromTransfer);
      return;
    }

    if (event.dataTransfer.files.length > 0) {
      attachPaths(pathsFromFileList(event.dataTransfer.files));
    }
  };

  return {
    dropAreaRef,
    dragOver,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
