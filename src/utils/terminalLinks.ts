import { WebLinksAddon } from "@xterm/addon-web-links";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { IDisposable, ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { useWorkspaceStore } from "../stores/workspace";
import { isTauri } from "./tauri";
import { findFileLinksInLine } from "./terminalFileLinks";

class FilePathLinkProvider implements ILinkProvider {
  constructor(private readonly terminal: Terminal) {}

  provideLinks(
    bufferLineNumber: number,
    callback: (links: ILink[] | undefined) => void,
  ): void {
    const line = this.terminal.buffer.active.getLine(bufferLineNumber - 1);
    if (!line) {
      callback(undefined);
      return;
    }

    const text = line.translateToString(false);
    const matches = findFileLinksInLine(text);
    if (matches.length === 0) {
      callback(undefined);
      return;
    }

    const links: ILink[] = matches.map((match) => ({
      text: match.text,
      range: {
        start: { x: match.startIndex + 1, y: bufferLineNumber },
        end: { x: match.startIndex + match.text.length, y: bufferLineNumber },
      },
      activate: () => {
        void useWorkspaceStore.getState().openFileAtLocation(match.text);
      },
    }));

    callback(links);
  }
}

async function handleUrlActivation(_event: MouseEvent, uri: string) {
  if (!isTauri()) {
    window.open(uri, "_blank", "noopener,noreferrer");
    return;
  }

  try {
    await openUrl(uri);
  } catch (error) {
    console.error("Failed to open URL:", error);
  }
}

export function attachTerminalLinks(terminal: Terminal): IDisposable[] {
  const disposables: IDisposable[] = [];
  terminal.loadAddon(new WebLinksAddon(handleUrlActivation));
  disposables.push(terminal.registerLinkProvider(new FilePathLinkProvider(terminal)));
  return disposables;
}
