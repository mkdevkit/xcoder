import { useEffect, useRef, useState } from "react";

export interface MenuBarItem {
  id: string;
  label: string;
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
  dividerBefore?: boolean;
  children?: MenuBarItem[];
}

export interface MenuBarMenu {
  id: string;
  label: string;
  items: MenuBarItem[];
}

interface MenuBarProps {
  menus: MenuBarMenu[];
}

function MenuItems({
  items,
  onRun,
}: {
  items: MenuBarItem[];
  onRun: (item: MenuBarItem) => void;
}) {
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);

  return (
    <>
      {items.map((item) => (
        <li
          key={item.id}
          className="menu-item-row"
          onMouseEnter={() => {
            if (item.children?.length) {
              setOpenSubmenuId(item.id);
            } else {
              setOpenSubmenuId(null);
            }
          }}
        >
          {item.dividerBefore && <div className="menu-divider" role="separator" />}
          {item.children && item.children.length > 0 ? (
            <div className={`menu-submenu-root ${openSubmenuId === item.id ? "open" : ""}`}>
              <button
                type="button"
                className="menu-item menu-item-submenu"
                role="menuitem"
                aria-haspopup="menu"
                disabled={item.disabled}
              >
                <span>{item.label}</span>
                <span className="menu-submenu-arrow">▶</span>
              </button>
              <ul className="menu-submenu" role="menu">
                {item.children.map((child) => (
                  <li key={child.id}>
                    {child.dividerBefore && (
                      <div className="menu-divider" role="separator" />
                    )}
                    <button
                      type="button"
                      className="menu-item"
                      role="menuitem"
                      disabled={child.disabled}
                      title={child.title}
                      onClick={() => onRun(child)}
                    >
                      {child.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <button
              type="button"
              className="menu-item"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => onRun(item)}
            >
              {item.label}
            </button>
          )}
        </li>
      ))}
    </>
  );
}

export function MenuBar({ menus }: MenuBarProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const barRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!openMenuId) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!barRef.current?.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenuId(null);
      }
    };

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenuId]);

  const runItem = (item: MenuBarItem) => {
    if (item.disabled || !item.onClick) return;
    setOpenMenuId(null);
    item.onClick();
  };

  return (
    <nav className="menu-bar" ref={barRef}>
      {menus.map((menu) => {
        const isOpen = openMenuId === menu.id;
        return (
          <div key={menu.id} className={`menu-root ${isOpen ? "open" : ""}`}>
            <button
              type="button"
              className="menu-trigger"
              aria-expanded={isOpen}
              aria-haspopup="menu"
              onClick={() =>
                setOpenMenuId((current) => (current === menu.id ? null : menu.id))
              }
            >
              {menu.label}
            </button>
            {isOpen && (
              <ul className="menu-dropdown" role="menu">
                <MenuItems items={menu.items} onRun={runItem} />
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
