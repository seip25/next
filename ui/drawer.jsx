"use client";
import { useEffect, useRef } from "react";
import { cn } from "./utils";

const placements = {
  right: "ml-auto mr-0 h-dvh max-h-dvh w-full max-w-md rounded-l-ui border-l open:animate-ui-slide-left",
  left: "mr-auto ml-0 h-dvh max-h-dvh w-full max-w-md rounded-r-ui border-r open:animate-ui-slide-right",
  bottom: "mb-0 mt-auto w-full max-w-none max-h-[85dvh] rounded-t-2xl border-t open:animate-ui-slide-up",
  top: "mt-0 mb-auto w-full max-w-none max-h-[85dvh] rounded-b-2xl border-b open:animate-ui-slide-down",
};

/**
 * Side panel (menus, filters, carts, detail views) on native <dialog>.
 * `side="bottom"` gives a mobile bottom sheet.
 * @param {{open: boolean, onClose: () => void, side?: "right"|"left"|"bottom"|"top", title?: any, footer?: any, className?: string}} props
 */
export function Drawer({ open, onClose, side = "right", title, footer, className, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose?.();
      }}
      className={cn("max-w-none border-border bg-surface p-0 text-fg shadow-2xl", placements[side] || placements.right, className)}
    >
      {open && (
        <div className="flex h-full flex-col">
          {side === "bottom" && <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-border" aria-hidden="true" />}
          <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="-m-1 rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg">
              <svg className="size-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export default Drawer;
