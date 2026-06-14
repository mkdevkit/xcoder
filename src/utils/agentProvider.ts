export const PROVIDER_LABELS: Record<string, string> = {
  codewhale: "CodeWhale",
  opencode: "OpenCode",
};

export interface AgentCommands {
  doctor: string;
  startRuntime: string;
  restartRuntime: string;
  stopRuntime: string;
  createThread: string;
  sendTurn: string;
  setThreadMode: string;
  approve: string;
  subscribeEvents: string;
  listThreads: string;
  loadThreadHistory: string;
  getPendingApproval?: string;
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
    createThread: `${providerId}_create_thread`,
    sendTurn: `${providerId}_send_turn`,
    setThreadMode: `${providerId}_set_thread_mode`,
    approve: `${providerId}_approve`,
    subscribeEvents: `${providerId}_subscribe_events`,
    listThreads:
      providerId === "opencode"
        ? "opencode_list_sessions"
        : "codewhale_list_threads",
    loadThreadHistory:
      providerId === "opencode"
        ? "opencode_load_session_history"
        : "codewhale_load_thread_history",
    getPendingApproval:
      providerId === "opencode"
        ? "opencode_get_pending_approval"
        : providerId === "codewhale"
          ? "codewhale_get_pending_approval"
          : undefined,
    deleteThread:
      providerId === "opencode"
        ? "opencode_delete_session"
        : "codewhale_delete_thread",
    updateThreadTitle:
      providerId === "opencode"
        ? "opencode_update_session_title"
        : undefined,
    listAgents:
      providerId === "opencode" ? "opencode_list_agents" : undefined,
    listProviderModels:
      providerId === "opencode"
        ? "opencode_list_provider_models"
        : providerId === "codewhale"
          ? "codewhale_list_models"
          : undefined,
  };
}

export function getProviderLabel(providerId: string) {
  return PROVIDER_LABELS[providerId] ?? providerId;
}
