import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "../i18n";

const COLLAPSED_LINE_HEIGHT_PX = 19.5;
const COLLAPSED_VISIBLE_LINES = 6;
const COLLAPSED_MAX_HEIGHT = COLLAPSED_LINE_HEIGHT_PX * COLLAPSED_VISIBLE_LINES;

interface CollapsibleMessagePartProps {
  children: ReactNode;
  className?: string;
  streamActive?: boolean;
}

export function CollapsibleMessagePart({
  children,
  className = "",
  streamActive = false,
}: CollapsibleMessagePartProps) {
  const { t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [canCollapse, setCanCollapse] = useState(false);

  const isCollapsed = canCollapse && !expanded;
  const shouldClamp = !expanded && (streamActive || canCollapse);

  const syncOverflow = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const overflows = viewport.scrollHeight > COLLAPSED_MAX_HEIGHT + 2;
    setCanCollapse(overflows);

    if (overflows && (!expanded || streamActive)) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [expanded, streamActive]);

  useLayoutEffect(() => {
    syncOverflow();
  }, [children, syncOverflow]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const observer = new ResizeObserver(() => {
      syncOverflow();
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [syncOverflow]);

  useEffect(() => {
    if (streamActive) {
      setExpanded(false);
    }
  }, [streamActive]);

  useLayoutEffect(() => {
    if (!shouldClamp) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [children, shouldClamp]);

  const handleToggle = () => {
    setExpanded((value) => !value);
  };

  return (
    <div
      className={`collapsible-message-part${isCollapsed ? " is-collapsed" : ""}${shouldClamp ? " is-clamped" : ""}${streamActive ? " is-streaming" : ""}${className ? ` ${className}` : ""}`}
    >
      {canCollapse && !streamActive && (
        <button
          type="button"
          className="collapsible-message-toggle"
          onClick={handleToggle}
          aria-expanded={!isCollapsed}
        >
          <span className="collapsible-message-toggle-icon" aria-hidden>
            {isCollapsed ? "▾" : "▴"}
          </span>
          {isCollapsed ? t("message.expandDetails") : t("message.collapseDetails")}
        </button>
      )}
      <div
        ref={viewportRef}
        className="collapsible-message-viewport"
        style={
          shouldClamp
            ? { maxHeight: `${COLLAPSED_MAX_HEIGHT}px` }
            : undefined
        }
      >
        {shouldClamp && <div className="collapsible-message-fade" aria-hidden />}
        <div className="collapsible-message-body">{children}</div>
      </div>
    </div>
  );
}
