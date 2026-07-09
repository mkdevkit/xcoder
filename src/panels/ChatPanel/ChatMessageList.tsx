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
    generating,
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
      behavior: generating ? "auto" : "smooth",
    });
  }, [scrollKey, pendingApproval, generating]);

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
        const streamActive = generating && turn.isLast;
        const hasTools = turn.inlineParts.some((part) => part.type === "tools");
        const hasAssistantBody = turnHasAssistantBody(turn.inlineParts);

        return (
          <div key={turn.id} className="chat-turn">
            {turn.user && <MessageBubble message={turn.user} />}
            {(hasAssistantBody || hasTools) && (
              <AssistantTurnBubble
                turnId={turn.id}
                parts={turn.inlineParts}
                streamActive={streamActive}
                toolsActive={streamActive && hasTools}
              />
            )}
          </div>
        );
      })}
      {generating && <StreamingIndicator />}
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
