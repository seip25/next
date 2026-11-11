"use client";
import { useEffect, useRef, useState } from "react";
import { cn, focusRing } from "./utils";

/**
 * Dropdown menu (actions per row, user menu…). Closes on outside click and Esc.
 * <Dropdown trigger={<Button variant="ghost" size="icon">⋯</Button>}
 *   items={[{ label: "Editar", onClick: edit }, { type: "separator" }, { label: "Eliminar", danger: true, onClick: remove }]} />
 * Items can also be links: { label: "Ver", href: "/users/1" }.
 */
export function Dropdown({ trigger, items = [], align = "end", className, menuClassName }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!root.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const itemClass = (item) =>
    cn(
      "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors disabled:opacity-50",
      focusRing,
      item.danger ? "text-danger hover:bg-danger/10" : "text-fg hover:bg-surface-2"
    );

  return (
    <div ref={root} className={cn("relative inline-block", className)}>
      <span onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        {trigger}
      </span>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute z-50 mt-1 min-w-44 rounded-ui border border-border bg-surface p-1 shadow-lg animate-ui-pop-in",
            align === "end" ? "right-0" : "left-0",
            menuClassName
          )}
        >
          {items.map((item, i) => {
            if (item.type === "separator") return <div key={i} className="my-1 h-px bg-border" role="separator" />;
            if (item.type === "label") return <div key={i} className="px-2.5 py-1 text-xs font-medium text-muted">{item.label}</div>;
            const content = (
              <>
                {item.icon}
                <span className="flex-1">{item.label}</span>
                {item.shortcut && <kbd className="text-xs text-muted">{item.shortcut}</kbd>}
              </>
            );
            return item.href ? (
              <a key={i} role="menuitem" href={item.href} className={itemClass(item)} onClick={() => setOpen(false)}>
                {content}
              </a>
            ) : (
              <button
                key={i}
                role="menuitem"
                type="button"
                disabled={item.disabled}
                className={itemClass(item)}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Dropdown;
