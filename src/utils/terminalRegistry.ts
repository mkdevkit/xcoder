type SelectionGetter = () => string;

const terminals = new Map<string, SelectionGetter>();

export function registerTerminal(id: string, getSelection: SelectionGetter) {
  terminals.set(id, getSelection);
}

export function unregisterTerminal(id: string) {
  terminals.delete(id);
}

export function getTerminalSelection(id: string | null): string {
  if (!id) return "";
  return terminals.get(id)?.() ?? "";
}
