import { useCallback, useRef, useState, type DragEvent } from "react";
import { extractDroppedPaths, hasExternalFilePayload } from "../utils/externalFileDrop";

interface UseDropZoneOptions {
  enabled?: boolean;
  accept?: (event: DragEvent) => boolean;
  getDropEffect?: (event: DragEvent) => DataTransfer["dropEffect"];
  onDrop: (paths: string[], event: DragEvent) => void | Promise<void>;
}

export function useDropZone({
  enabled = true,
  accept,
  getDropEffect,
  onDrop,
}: UseDropZoneOptions) {
  const [active, setActive] = useState(false);
  const depthRef = useRef(0);

  const canAccept = useCallback(
    (event: DragEvent) => {
      if (!enabled) return false;
      if (!event.dataTransfer) return false;
      if (accept) return accept(event);
      return hasExternalFilePayload(event.dataTransfer);
    },
    [accept, enabled],
  );

  const resolveDropEffect = useCallback(
    (event: DragEvent): DataTransfer["dropEffect"] => {
      if (getDropEffect) return getDropEffect(event);
      return "copy";
    },
    [getDropEffect],
  );

  const handleDragEnter = useCallback(
    (event: DragEvent) => {
      if (!canAccept(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depthRef.current += 1;
      event.dataTransfer!.dropEffect = resolveDropEffect(event);
      setActive(true);
    },
    [canAccept, resolveDropEffect],
  );

  const handleDragOver = useCallback(
    (event: DragEvent) => {
      if (!canAccept(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer!.dropEffect = resolveDropEffect(event);
      setActive(true);
    },
    [canAccept, resolveDropEffect],
  );

  const handleDragLeave = useCallback((event: DragEvent) => {
    event.stopPropagation();
    depthRef.current -= 1;
    if (depthRef.current <= 0) {
      depthRef.current = 0;
      setActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      depthRef.current = 0;
      setActive(false);
      if (!enabled) return;

      const paths = extractDroppedPaths(event);
      if (paths.length === 0) return;
      void onDrop(paths, event);
    },
    [enabled, onDrop],
  );

  return {
    active,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
