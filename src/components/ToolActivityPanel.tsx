import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n";
import type { ChatMessage } from "../types/agent";
import {
  formatToolContent,
  getToolPreview,
  getToolRoleLabel,
  parseToolContent,
} from "../utils/toolMessage";

interface ToolActivityPanelProps {
  tools: ChatMessage[];
  active: boolean;
  embedded?: boolean;
}

function toolsPropsEqual(
  prevTools: ChatMessage[],
  nextTools: ChatMessage[],
): boolean {
  if (prevTools === nextTools) return true;
  if (prevTools.length !== nextTools.length) return false;
  for (let i = 0; i < prevTools.length; i += 1) {
    const prev = prevTools[i];
    const next = nextTools[i];
    if (
      prev.id !== next.id ||
      prev.content !== next.content ||
      prev.toolName !== next.toolName
    ) {
      return false;
    }
  }
  return true;
}

function ToolActivityPanelInner({
  tools,
  active,
  embedded = false,
}: ToolActivityPanelProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const latest = tools[tools.length - 1];
  const latestPreview = latest
    ? getToolPreview(latest.content, latest.toolName)
    : "";

  useEffect(() => {
    if (!expanded || !active) return;
    bodyRef.current?.scrollTo({
      top: bodyRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [tools.length, latest?.content, expanded, active]);

  if (tools.length === 0) return null;

  return (
    <div
      className={`tool-activity-panel ${active ? "active" : ""} ${embedded ? "embedded" : ""}`}
    >
      <button
        type="button"
        className="tool-activity-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="tool-activity-leading">
          <span className="tool-activity-label">{t("chat.toolActivity")}</span>
          <span className="tool-activity-count">{tools.length}</span>
        </span>
        {!expanded && (
          <span className="tool-activity-preview" title={latestPreview}>
            {latestPreview}
          </span>
        )}
        <span className="tool-activity-chevron" aria-hidden>
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div ref={bodyRef} className="tool-activity-body">
          {tools.map((tool) => {
            const detail = formatToolContent(
              parseToolContent(tool.content),
              tool.toolName,
            );
            return (
              <div key={tool.id} className="tool-activity-item">
                <div className="tool-activity-item-meta">
                  {getToolRoleLabel(tool.toolName)}
                </div>
                <pre className="tool-activity-item-detail">{detail}</pre>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const ToolActivityPanel = memo(
  ToolActivityPanelInner,
  (prev, next) =>
    prev.active === next.active &&
    prev.embedded === next.embedded &&
    toolsPropsEqual(prev.tools, next.tools),
);
