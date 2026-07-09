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
    activeTurn,
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
        const isAnchorTurn =
          generating && turn.user?.id === activeTurn?.anchorId;
        const streamActive =
          isAnchorTurn ||
          (generating && turn.isLast && !activeTurn?.anchorId);

        return (
          <div key={turn.id} className="chat-turn">
            {turn.user && <MessageBubble message={turn.user} />}
            {turn.assistantGroups.map((group, groupIndex) => {
              const isLastGroup = groupIndex === turn.assistantGroups.length - 1;
              const groupStreamActive = streamActive && isLastGroup;
              const hasTools = group.parts.some((part) => part.type === "tools");
              const hasAssistantBody = turnHasAssistantBody(group.parts);
              if (!hasAssistantBody && !hasTools) return null;

              return (
                <AssistantTurnBubble
                  key={`${group.messageId}:${groupIndex}`}
                  turnId={group.messageId}
                  parts={group.parts}
                  streamActive={groupStreamActive}
                  toolsActive={groupStreamActive && hasTools}
                />
              );
            })}
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
