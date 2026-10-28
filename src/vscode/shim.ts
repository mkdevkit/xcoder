declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

type InvokeResult = {
  type: "invoke-result";
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
};

type EventMessage = {
  type: "event";
  callbackId: number;
  event: string;
  eventId: string;
  payload: unknown;
};

type Callback = {
  fn: (message: unknown) => void;
  once: boolean;
};

const vscode = acquireVsCodeApi();
const callbacks = new Map<number, Callback>();
const pending = new Map<
  number,
  {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }
>();

let nextInvokeId = 1;
let nextCallbackId = 1;

const internals = {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
    const id = nextInvokeId;
    nextInvokeId += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      vscode.postMessage({ type: "invoke", id, cmd: command, args: args ?? {} });
    });
  },
  transformCallback(callback: (message: unknown) => void, once = false) {
    const id = nextCallbackId;
    nextCallbackId += 1;
    callbacks.set(id, { fn: callback, once });
    return id;
  },
  unregisterCallback(id: number) {
    callbacks.delete(id);
  },
  convertFileSrc(filePath: string) {
    return filePath;
  },
  metadata: {
    currentWindow: { label: "main" },
    currentWebview: { label: "main" },
  },
};

const eventInternals = {
  unregisterListener() {
    // The extension host removes listeners via plugin:event|unlisten.
  },
};

(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = internals;
(window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ =
  eventInternals;
(window as unknown as Record<string, unknown>).isTauri = true;
(window as unknown as Record<string, unknown>).__XCODER_VSCODE__ = true;

const clipboard = {
  readText: () =>
    internals.invoke("xcoder_clipboard_read") as Promise<string>,
  writeText: (text: string) =>
    internals.invoke("xcoder_clipboard_write", { text }) as Promise<void>,
};
try {
  Object.defineProperty(navigator, "clipboard", {
    value: clipboard,
    configurable: true,
  });
} catch {
  try {
    (navigator as unknown as Record<string, unknown>).clipboard = clipboard;
  } catch {
    // Clipboard shortcuts will fall back to the webview default behavior.
  }
}

window.addEventListener("message", (event: MessageEvent) => {
  const message = event.data as
    | InvokeResult
    | EventMessage
    | { type: "init"; [key: string]: unknown }
    | { type: "workspace"; workspace?: string | null };

  if (!message || typeof message !== "object") return;

  if (message.type === "invoke-result") {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.ok) {
      entry.resolve(message.result);
    } else {
      entry.reject(new Error(message.error ?? "invoke failed"));
    }
    return;
  }

  if (message.type === "event") {
    const callback = callbacks.get(message.callbackId);
    if (!callback) return;
    callback.fn({
      event: message.event,
      id: message.eventId,
      payload: message.payload,
    });
    if (callback.once) {
      callbacks.delete(message.callbackId);
    }
    return;
  }

  if (message.type === "init" || message.type === "workspace") {
    if (message.type === "init") {
      (window as unknown as Record<string, unknown>).__XCODER_INIT__ = message;
    }
    window.dispatchEvent(new CustomEvent("xcoder:init", { detail: message }));
  }
});

vscode.postMessage({ type: "ready" });
