import { memo } from "react";
import type { ChatMessage } from "../types/agent";
import { useChatStore } from "../stores/chat";
import { getProviderLabel } from "../utils/agentProvider";
import { MarkdownContent } from "./MarkdownContent";
import { CollapsibleMessagePart } from "./CollapsibleMessagePart";
import { useTranslation } from "../i18n";

interface MessageBubbleProps {
  message: ChatMessage;
  showPlaceholder?: boolean;
  streamActive?: boolean;
}

function MessageBubbleInner({
  message,
  showPlaceholder = false,
  streamActive = false,
}: MessageBubbleProps) {
  const { t } = useTranslation();
  const providerId = useChatStore((state) => state.providerId);
  const assistantLabel = getProviderLabel(providerId);
  const isUser = message.role === "user";

  if (message.role === "tool") return null;

  if (
    !message.content &&
    message.role === "assistant" &&
    !showPlaceholder &&
    !streamActive
  ) {
    return null;
  }

  return (
    <div className={`message-bubble ${message.role}`}>
      <div className="message-meta">
        {isUser ? t("message.you") : assistantLabel}
      </div>
      {isUser ? (
        <CollapsibleMessagePart className="user-message-part">
          <pre className="message-content">{message.content || "…"}</pre>
        </CollapsibleMessagePart>
      ) : (
        <div className="message-content">
          {message.content ? (
            <CollapsibleMessagePart streamActive={streamActive}>
              {streamActive ? (
                <pre className="message-streaming">{message.content}</pre>
              ) : (
                <MarkdownContent content={message.content} />
              )}
            </CollapsibleMessagePart>
          ) : (
            <span className="message-placeholder">…</span>
          )}
        </div>
      )}
    </div>
  );
}

export const MessageBubble = memo(
  MessageBubbleInner,
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.role === next.message.role &&
    prev.showPlaceholder === next.showPlaceholder &&
    prev.streamActive === next.streamActive,
);
