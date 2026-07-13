export const PROVIDER_LABELS: Record<string, string> = {
  opencode: "OpenCode",
};

export interface AgentCommands {
  doctor: string;
  startRuntime: string;
  restartRuntime: string;
  stopRuntime: string;
  runtimeStatus: string;
  createThread: string;
  sendTurn: string;
  cancelTurn?: string;
  setThreadMode: string;
  approve: string;
  subscribeEvents: string;
  listThreads: string;
  loadThreadHistory: string;
  getPendingApproval?: string;
  getPendingQuestion?: string;
  replyQuestion?: string;
  rejectQuestion?: string;
  isSessionBusy?: string;
  deleteThread: string;
  updateThreadTitle?: string;
  listAgents?: string;
  listProviderModels?: string;
}

export function getAgentCommands(providerId: string): AgentCommands {
  return {
    doctor: `${providerId}_doctor`,
    startRuntime: `${providerId}_start_runtime`,
    restartRuntime: `${providerId}_restart_runtime`,
    stopRuntime: `${providerId}_stop_runtime`,
    runtimeStatus: `${providerId}_runtime_status`,
    createThread: `${providerId}_create_thread`,
    sendTurn: `${providerId}_send_turn`,
    cancelTurn: `${providerId}_cancel_turn`,
    setThreadMode: `${providerId}_set_thread_mode`,
    approve: `${providerId}_approve`,
    subscribeEvents: `${providerId}_subscribe_events`,
    listThreads: "opencode_list_sessions",
    loadThreadHistory: "opencode_load_session_history",
    getPendingApproval: "opencode_get_pending_approval",
    getPendingQuestion: "opencode_get_pending_question",
    replyQuestion: "opencode_reply_question",
    rejectQuestion: "opencode_reject_question",
    isSessionBusy: "opencode_is_session_busy",
    deleteThread: "opencode_delete_session",
    updateThreadTitle: "opencode_update_session_title",
    listAgents: "opencode_list_agents",
    listProviderModels: "opencode_list_provider_models",
  };
}

export function getProviderLabel(providerId: string) {
  return PROVIDER_LABELS[providerId] ?? providerId;
}
