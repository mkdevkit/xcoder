import type { FitAddon } from "@xterm/addon-fit";

export function canFitTerminal(container: HTMLElement): boolean {
  return container.offsetWidth > 0 && container.offsetHeight > 0;
}

export function safeFitTerminal(
  fitAddon: FitAddon,
  container: HTMLElement,
): boolean {
  if (!canFitTerminal(container)) return false;
  try {
    fitAddon.fit();
    return true;
  } catch {
    return false;
  }
}

export function scheduleTerminalFit(
  fitAddon: FitAddon,
  container: HTMLElement,
  onFit?: () => void,
): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!safeFitTerminal(fitAddon, container)) return;
      onFit?.();
    });
  });
}
