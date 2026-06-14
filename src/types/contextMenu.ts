export interface ContextMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export type ContextZone = "explorer" | "editor" | "terminal" | "general";
