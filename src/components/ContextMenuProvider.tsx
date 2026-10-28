import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ContextMenuItem, ContextMenuState } from "../types/contextMenu";

interface ContextMenuContextValue {
  showMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  hideMenu: () => void;
  setMenuHandler: (handler: ((event: MouseEvent) => void) | null) => void;
}

const ContextMenuContext = createContext<ContextMenuContextValue | null>(null);

function ContextMenuOverlay({
  menu,
  onClose,
}: {
  menu: ContextMenuState;
  onClose: () => void;
}) {
  const blockNativeMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <>
      <div
        className="context-menu-backdrop"
        onClick={onClose}
        onContextMenu={(event) => {
          blockNativeMenu(event);
          onClose();
        }}
      />
      <ul
        className="context-menu"
        style={{ left: menu.x, top: menu.y }}
        onContextMenu={blockNativeMenu}
      >
        {menu.items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              disabled={item.disabled}
              onClick={() => {
                if (!item.disabled) {
                  item.onClick();
                }
                onClose();
              }}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
      <style>{`
        .context-menu-backdrop {
          position: fixed;
          inset: 0;
          z-index: 9998;
        }
        .context-menu {
          position: fixed;
          z-index: 9999;
          min-width: 180px;
          margin: 0;
          padding: 4px 0;
          list-style: none;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 6px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        }
        .context-menu button {
          display: block;
          width: 100%;
          text-align: left;
          border: none;
          background: transparent;
          padding: 7px 14px;
          border-radius: 0;
        }
        .context-menu button:hover:not(:disabled) {
          background: var(--bg-hover);
        }
        .context-menu button:disabled {
          opacity: 0.45;
        }
      `}</style>
    </>
  );
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const menuHandlerRef = useRef<((event: MouseEvent) => void) | null>(null);

  const hideMenu = useCallback(() => setMenu(null), []);
  const showMenu = useCallback((x: number, y: number, items: ContextMenuItem[]) => {
    if (items.length === 0) return;
    setMenu({ x, y, items });
  }, []);

  const setMenuHandler = useCallback((handler: ((event: MouseEvent) => void) | null) => {
    menuHandlerRef.current = handler;
  }, []);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      menuHandlerRef.current?.(event);
    };

    const preventBrowserShortcuts = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === "f5" || (event.ctrlKey && key === "r") || (event.ctrlKey && key === "f5")) {
        event.preventDefault();
      }
    };

    document.addEventListener("contextmenu", onContextMenu, { capture: true });
    window.addEventListener("keydown", preventBrowserShortcuts);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu, { capture: true });
      window.removeEventListener("keydown", preventBrowserShortcuts);
    };
  }, []);

  return (
    <ContextMenuContext.Provider value={{ showMenu, hideMenu, setMenuHandler }}>
      {children}
      {menu && <ContextMenuOverlay menu={menu} onClose={hideMenu} />}
    </ContextMenuContext.Provider>
  );
}

export function useContextMenu() {
  const context = useContext(ContextMenuContext);
  if (!context) {
    throw new Error("useContextMenu must be used within ContextMenuProvider");
  }
  return context;
}
