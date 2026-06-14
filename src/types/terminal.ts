export interface TerminalTab {
  id: string;
  title: string;
  cwd?: string;
  exited: boolean;
}

export interface TerminalOutputPayload {
  id: string;
  data: string;
}

export interface TerminalExitPayload {
  id: string;
}
