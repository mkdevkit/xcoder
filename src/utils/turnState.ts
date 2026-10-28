export type TurnPhase = "idle" | "streaming" | "cancelling" | "awaiting_approval" | "awaiting_question";

export type TurnAnchorKind = "turn_id" | "message_id";

export interface ActiveTurn {
  phase: TurnPhase;
  anchorId: string;
  anchorKind: TurnAnchorKind;
  localUserMessageId: string;
  /** Entry ids that existed before the current user message was sent. */
  baselineEntryIds?: string[];
  /** OpenCode assistant message id for the active response. */
  assistantMessageId?: string | null;
}

export function createActiveTurn(
  anchorId: string,
  anchorKind: TurnAnchorKind,
  localUserMessageId: string,
  phase: TurnPhase = "streaming",
  baselineEntryIds?: string[],
): ActiveTurn {
  return {
    phase,
    anchorId,
    anchorKind,
    localUserMessageId,
    baselineEntryIds,
  };
}

export function isTurnPhaseBusy(phase: TurnPhase): boolean {
  return phase !== "idle";
}

export function isTurnBusy(turn: ActiveTurn | null | undefined): boolean {
  return turn != null && isTurnPhaseBusy(turn.phase);
}

export function streamingFromTurn(turn: ActiveTurn | null | undefined): boolean {
  if (!turn) return false;
  return (
    turn.phase === "streaming" ||
    turn.phase === "awaiting_approval" ||
    turn.phase === "awaiting_question"
  );
}

export function isGenerating(slice: {
  streaming: boolean;
  activeTurn: ActiveTurn | null;
}): boolean {
  if (slice.activeTurn) {
    return streamingFromTurn(slice.activeTurn);
  }
  return slice.streaming;
}

export function acceptsAgentStreamUpdates(
  turn: ActiveTurn | null | undefined,
  fallbackStreaming: boolean,
): boolean {
  if (turn) {
    return (
      turn.phase === "streaming" ||
      turn.phase === "awaiting_approval" ||
      turn.phase === "awaiting_question"
    );
  }
  return fallbackStreaming;
}

export function withTurnPhase(
  turn: ActiveTurn,
  phase: TurnPhase,
): ActiveTurn {
  return { ...turn, phase };
}

export function anchorKindForProvider(_providerId: string) {
  return "message_id" as const;
}
