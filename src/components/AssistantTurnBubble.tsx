import { memo } from "react";
import { useChatStore } from "../stores/chat";
import { getProviderLabel } from "../utils/agentProvider";
import { MarkdownContent } from "./MarkdownContent";
import { CollapsibleMessagePart } from "./CollapsibleMessagePart";
import { ToolActivityPanel } from "./ToolActivityPanel";
import type { TurnInlinePart } from "../utils/chatTurns";
import { isLastTextPart } from "../utils/chatTurns";

interface AssistantTurnBubbleProps {
  turnId: string;
  parts: TurnInlinePart[];
  streamActive: boolean;
  toolsActive: boolean;
}

function AssistantTurnBubbleInner({
  turnId,
  parts,
  streamActive,
  toolsActive,
}: AssistantTurnBubbleProps) {
  const providerId = useChatStore((state) => state.providerId);
  const assistantLabel = getProviderLabel(providerId);

  const hasVisibleText = parts.some(
    (part) => part.type === "text" && part.content.trim(),
  );
  const hasTools = parts.some((part) => part.type === "tools");

  if (!hasVisibleText && !hasTools) {
    return null;
  }

  return (
    <div className="message-bubble assistant">
      <div className="message-meta">{assistantLabel}</div>
      <div className="message-content assistant-turn-content">
        {parts.map((part, partIndex) => {
          if (part.type === "tools") {
            return (
              <ToolActivityPanel
                key={part.id}
                tools={part.tools}
                active={toolsActive}
                embedded
              />
            );
          }

          const hasText = part.content.trim().length > 0;
          if (!hasText) {
            return null;
          }

          const isStreamingPart =
            streamActive && isLastTextPart(parts, partIndex);

          return (
            <div
              key={isStreamingPart ? `streaming-${turnId}` : part.id}
              className={`assistant-turn-text ${isStreamingPart ? "is-streaming-slot" : ""}`}
            >
              <CollapsibleMessagePart streamActive={isStreamingPart}>
                {isStreamingPart ? (
                  <pre className="message-streaming">{part.content}</pre>
                ) : (
                  <MarkdownContent content={part.content} />
                )}
              </CollapsibleMessagePart>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function partsEqual(prev: TurnInlinePart[], next: TurnInlinePart[]): boolean {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    const a = prev[i];
    const b = next[i];
    if (a.type !== b.type || a.id !== b.id) return false;
    if (a.type === "text" && b.type === "text") {
      if (a.content !== b.content) return false;
    } else if (a.type === "tools" && b.type === "tools") {
      if (a.tools.length !== b.tools.length) return false;
      for (let j = 0; j < a.tools.length; j += 1) {
        if (
          a.tools[j].id !== b.tools[j].id ||
          a.tools[j].content !== b.tools[j].content ||
          a.tools[j].toolName !== b.tools[j].toolName
        ) {
          return false;
        }
      }
    }
  }
  return true;
}

export const AssistantTurnBubble = memo(
  AssistantTurnBubbleInner,
  (prev, next) =>
    prev.turnId === next.turnId &&
    partsEqual(prev.parts, next.parts) &&
    prev.streamActive === next.streamActive &&
    prev.toolsActive === next.toolsActive,
);
