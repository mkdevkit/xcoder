import { useEffect, useMemo, useRef } from "react";
import { ApprovalGate } from "../../components/ApprovalGate";
import { AssistantTurnBubble } from "../../components/AssistantTurnBubble";
import { MessageBubble } from "../../components/MessageBubble";
import { StreamingIndicator } from "../../components/StreamingIndicator";
import { useChatStore, useActiveProviderChat } from "../../stores/chat";
import { useTranslation } from "../../i18n";
import { getProviderLabel } from "../../utils/agentProvider";
import {
  buildChatTurns,
  turnHasAssistantBody,
} from "../../utils/chatTurns";

export function ChatMessageList() {
  const bottomRef = useRef<HTMLDivElement>(null);
  const {
    messages,
    streaming,
    pendingApproval,
    providerId,
    connectedIntent,
    runtime,
    thread,
  } = useActiveProviderChat();
  const approve = useChatStore((state) => state.approve);
  const { t } = useTranslation();
  const providerLabel = getProviderLabel(providerId);

  const chatTurns = useMemo(() => buildChatTurns(messages), [messages]);

  const scrollKey = useMemo(() => {
    const last = messages[messages.length - 1];
    return `${messages.length}:${last?.id ?? ""}:${last?.content?.length ?? 0}`;
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: streaming ? "auto" : "smooth",
    });
  }, [scrollKey, pendingApproval, streaming]);

  return (
    <div className="chat-messages">
      {messages.length === 0 && (
        <div className="chat-placeholder">
          {!connectedIntent
            ? t("chat.connectInProjectPrefs")
            : !runtime.running
              ? t("chat.serviceNotRunning")
              : !thread
                ? t("chat.hintNoSession")
                : t("chat.hintReady", { provider: providerLabel })}
        </div>
      )}
      {chatTurns.map((turn) => {
        const streamActive = streaming && turn.isLast;
        const lastTextPart = [...turn.inlineParts]
          .reverse()
          .find((part) => part.type === "text");
        const showPlaceholder =
          streamActive && !lastTextPart?.content.trim();
        const hasTools = turn.inlineParts.some((part) => part.type === "tools");

        return (
          <div key={turn.id} className="chat-turn">
            {turn.user && <MessageBubble message={turn.user} />}
            {(turnHasAssistantBody(turn.inlineParts) ||
              showPlaceholder ||
              hasTools) && (
              <AssistantTurnBubble
                turnId={turn.id}
                parts={turn.inlineParts}
                streamActive={streamActive}
                toolsActive={streamActive && hasTools}
                showPlaceholder={showPlaceholder}
              />
            )}
          </div>
        );
      })}
      {streaming && <StreamingIndicator />}
      {pendingApproval && (
        <ApprovalGate
          description={pendingApproval.description}
          onApprove={() => approve(true).catch(console.error)}
          onDeny={() => approve(false).catch(console.error)}
        />
      )}
      <div ref={bottomRef} />
    </div>
  );
}
