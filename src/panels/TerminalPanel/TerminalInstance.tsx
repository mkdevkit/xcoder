import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { useTerminalStore } from "../../stores/terminal";
import { attachTerminalLinks } from "../../utils/terminalLinks";
import { registerTerminal, unregisterTerminal } from "../../utils/terminalRegistry";
import { tauriInvoke } from "../../utils/tauri";
import type { TerminalExitPayload, TerminalOutputPayload } from "../../types/terminal";
import "@xterm/xterm/css/xterm.css";

interface TerminalInstanceProps {
  id: string;
  active: boolean;
}

export function TerminalInstance({ id, active }: TerminalInstanceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const markTerminalExited = useTerminalStore((state) => state.markTerminalExited);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "Cascadia Code, Consolas, Monaco, monospace",
      theme: {
        background: "#1e1e1e",
        foreground: "#cccccc",
        cursor: "#cccccc",
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;
    registerTerminal(id, () => term.getSelection());
    const linkDisposables = attachTerminalLinks(term);

    const dataDisposable = term.onData((data) => {
      tauriInvoke("terminal_write", { id, data }).catch(console.error);
    });

    const resizeObserver = new ResizeObserver(() => {
      if (!active) return;
      fitAddon.fit();
      tauriInvoke("terminal_resize", {
        id,
        cols: term.cols,
        rows: term.rows,
      }).catch(() => undefined);
    });
    resizeObserver.observe(containerRef.current);

    const unlistenOutput = listen<TerminalOutputPayload>("terminal-output", (event) => {
      if (event.payload.id !== id) return;
      term.write(event.payload.data);
    });

    const unlistenExit = listen<TerminalExitPayload>("terminal-exit", (event) => {
      if (event.payload.id !== id) return;
      term.writeln("\r\n\x1b[33m[进程已退出]\x1b[0m");
      markTerminalExited(id);
    });

    return () => {
      unregisterTerminal(id);
      linkDisposables.forEach((item) => item.dispose());
      dataDisposable.dispose();
      resizeObserver.disconnect();
      unlistenOutput.then((fn) => fn());
      unlistenExit.then((fn) => fn());
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [id, markTerminalExited]);

  useEffect(() => {
    if (!active || !fitAddonRef.current || !terminalRef.current) return;
    fitAddonRef.current.fit();
    tauriInvoke("terminal_resize", {
      id,
      cols: terminalRef.current.cols,
      rows: terminalRef.current.rows,
    }).catch(() => undefined);
  }, [active, id]);

  return (
    <div
      className="terminal-instance"
      style={{ display: active ? "block" : "none" }}
      ref={containerRef}
    />
  );
}
