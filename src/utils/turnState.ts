export type TurnPhase = "idle" | "streaming" | "cancelling" | "awaiting_approval";

export type TurnAnchorKind = "turn_id" | "message_id";

export interface ActiveTurn {
  phase: TurnPhase;
  anchorId: string;
  anchorKind: TurnAnchorKind;
  localUserMessageId: string;
}

export function createActiveTurn(
  anchorId: string,
  anchorKind: TurnAnchorKind,
  localUserMessageId: string,
  phase: TurnPhase = "streaming",
): ActiveTurn {
  return {
    phase,
    anchorId,
    anchorKind,
    localUserMessageId,
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
  return turn.phase === "streaming" || turn.phase === "awaiting_approval";
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
    return turn.phase === "streaming" || turn.phase === "awaiting_approval";
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
