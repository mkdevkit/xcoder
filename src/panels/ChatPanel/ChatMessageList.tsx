import { useEffect, useMemo, useRef } from "react";
import { ApprovalGate } from "../../components/ApprovalGate";
import { QuestionGate } from "../../components/QuestionGate";
import { AssistantTurnBubble } from "../../components/AssistantTurnBubble";
import { MessageBubble } from "../../components/MessageBubble";
import { StreamingIndicator } from "../../components/StreamingIndicator";
import { useChatStore, useActiveProviderChat } from "../../stores/chat";
import { useTranslation } from "../../i18n";
import { getProviderLabel } from "../../utils/agentProvider";
import type { TranslationKey } from "../../i18n/types";
import {
  buildChatTurns,
  turnHasAssistantBody,
} from "../../utils/chatTurns";
import { currentChatTurnHasRunningTools } from "../../utils/chatProjection";

const NEAR_BOTTOM_PX = 80;

export function ChatMessageList() {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const gateRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const {
    messages,
    generating,
    pendingApproval,
    pendingQuestion,
    providerId,
    connectedIntent,
    runtime,
    thread,
    activeTurn,
  } = useActiveProviderChat();
  const approve = useChatStore((state) => state.approve);
  const replyQuestion = useChatStore((state) => state.replyQuestion);
  const rejectQuestion = useChatStore((state) => state.rejectQuestion);
  const { t } = useTranslation();
  const providerLabel = getProviderLabel(providerId);

  const chatTurns = useMemo(() => buildChatTurns(messages), [messages]);
  const runningTools = useMemo(
    () => generating && currentChatTurnHasRunningTools(messages),
    [generating, messages],
  );
  const statusLabelKey: TranslationKey = runningTools
    ? "chat.runningTools"
    : "chat.generating";
  const awaitingInput = Boolean(pendingApproval || pendingQuestion);
  const pendingGateId = pendingQuestion?.id ?? pendingApproval?.id ?? null;

  const scrollKey = useMemo(() => {
    const last = messages[messages.length - 1];
    return `${messages.length}:${last?.id ?? ""}:${last?.content?.length ?? 0}`;
  }, [messages]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distance <= NEAR_BOTTOM_PX;
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // 审批/选项面板出现时：停住贴底跟随，把面板顶部滚进可视区，方便浏览长选项
  useEffect(() => {
    if (!pendingGateId) {
      stickToBottomRef.current = true;
      return;
    }
    stickToBottomRef.current = false;
    gateRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [pendingGateId]);

  useEffect(() => {
    if (awaitingInput) return;
    if (!stickToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({
      behavior: generating ? "auto" : "smooth",
    });
  }, [scrollKey, generating, awaitingInput]);

  return (
    <div className="chat-messages" ref={containerRef}>
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
                  toolsActive={generating && turn.isLast && isLastGroup && hasTools}
                />
              );
            })}
          </div>
        );
      })}
      {generating && <StreamingIndicator labelKey={statusLabelKey} />}
      {(pendingQuestion || pendingApproval) && (
        <div ref={gateRef}>
          {pendingQuestion && (
            <QuestionGate
              pending={pendingQuestion}
              onSubmit={(answers) => replyQuestion(answers).catch(console.error)}
              onDismiss={() => rejectQuestion().catch(console.error)}
            />
          )}
          {pendingApproval && (
            <ApprovalGate
              description={pendingApproval.description}
              onApprove={() => approve(true).catch(console.error)}
              onDeny={() => approve(false).catch(console.error)}
            />
          )}
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
