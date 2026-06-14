import { useState } from "react";
import type { ChatMessage } from "../types/agent";
import { useChatStore } from "../stores/chat";
import { getProviderLabel } from "../utils/agentProvider";
import { getToolPreview } from "../utils/toolMessage";
import { MarkdownContent } from "./MarkdownContent";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const providerId = useChatStore((state) => state.providerId);
  const streaming = useChatStore(
    (state) =>
      state.providerStates[state.providerId]?.streaming ?? false,
  );
  const messages = useChatStore(
    (state) => state.providerStates[state.providerId]?.messages ?? [],
  );
  const assistantLabel = getProviderLabel(providerId);
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const [toolExpanded, setToolExpanded] = useState(false);
  const isLastMessage = messages[messages.length - 1]?.id === message.id;

  if (isTool) {
    const preview = getToolPreview(message.content);
    return (
      <div className="message-bubble tool">
        <div className="message-meta">工具 · {message.toolName ?? "unknown"}</div>
        {!toolExpanded ? (
          <div className="tool-preview">{preview}</div>
        ) : (
          <pre className="message-content tool-detail">{message.content}</pre>
        )}
        <div className="tool-toggle-wrap">
          <button
            type="button"
            className="tool-toggle"
            aria-label={toolExpanded ? "收起详情" : "查看详情"}
            onClick={() => setToolExpanded((v) => !v)}
          >
            {toolExpanded ? "▲" : "▼"}
          </button>
        </div>
        <style>{toolStyles}</style>
      </div>
    );
  }

  if (!message.content && message.role === "assistant") {
    if (!streaming || !isLastMessage) return null;
  }

  return (
    <div className={`message-bubble ${message.role}`}>
      <div className="message-meta">
        {isUser ? "你" : assistantLabel}
      </div>
      {isUser ? (
        <pre className="message-content">{message.content || "…"}</pre>
      ) : (
        <div className="message-content">
          {message.content ? (
            <MarkdownContent content={message.content} />
          ) : (
            <span className="message-placeholder">…</span>
          )}
        </div>
      )}
      <style>{baseStyles}</style>
    </div>
  );
}

const baseStyles = `
  .message-bubble {
    margin-bottom: 12px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
  }
  .message-bubble.user {
    background: rgba(0, 120, 212, 0.12);
    border-color: rgba(0, 120, 212, 0.35);
  }
  .message-meta {
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 6px;
  }
  .message-content {
    margin: 0;
    word-break: break-word;
    font-family: var(--font-ui);
    font-size: 13px;
    line-height: 1.5;
  }
  .message-bubble.user .message-content {
    white-space: pre-wrap;
  }
  .message-placeholder {
    color: var(--text-muted);
  }
`;

const toolStyles = `
  ${baseStyles}
  .message-bubble.tool {
    background: rgba(78, 201, 176, 0.08);
    border-color: rgba(78, 201, 176, 0.25);
  }
  .tool-preview {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
    word-break: break-word;
  }
  .tool-detail {
    margin-top: 4px;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    background: rgba(0, 0, 0, 0.2);
    padding: 8px;
    border-radius: 4px;
  }
  .tool-toggle-wrap {
    display: flex;
    justify-content: center;
    margin-top: 8px;
  }
  .tool-toggle {
    padding: 2px 8px;
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 10px;
    line-height: 1;
    cursor: pointer;
  }
  .tool-toggle:hover {
    color: var(--accent, #4ec9b0);
  }
`;
