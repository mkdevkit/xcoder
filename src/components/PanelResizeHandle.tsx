import { useCallback } from "react";

interface PanelResizeHandleProps {
  direction: "horizontal" | "vertical";
  onResizeDelta: (delta: number) => void;
}

export function PanelResizeHandle({
  direction,
  onResizeDelta,
}: PanelResizeHandleProps) {
  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();

      const cursorClass =
        direction === "horizontal" ? "resizing-horizontal" : "resizing-vertical";
      document.body.classList.add("panel-resizing", cursorClass);

      let lastPos = direction === "horizontal" ? event.clientX : event.clientY;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const currentPos =
          direction === "horizontal" ? moveEvent.clientX : moveEvent.clientY;
        const delta = currentPos - lastPos;
        lastPos = currentPos;
        if (delta !== 0) {
          onResizeDelta(delta);
        }
      };

      const onMouseUp = () => {
        document.body.classList.remove("panel-resizing", cursorClass);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [direction, onResizeDelta],
  );

  return (
    <div
      className={`panel-resize-handle ${direction}`}
      onMouseDown={handleMouseDown}
      role="separator"
      aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"}
    />
  );
}
