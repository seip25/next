"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { cn } from "./utils";
import { Button } from "./button";

const sizes = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl", full: "max-w-[calc(100vw-2rem)] h-[calc(100dvh-2rem)]" };

/**
 * Modal built on native <dialog>: focus trap, Esc to close and top-layer rendering for free.
 * @param {{open: boolean, onClose: () => void, title?: any, description?: any, footer?: any,
 *   size?: "sm"|"md"|"lg"|"xl"|"full", dismissible?: boolean, className?: string}} props
 */
export function Modal({ open, onClose, title, description, footer, size = "md", dismissible = true, className, children }) {
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
        if (dismissible) onClose?.();
      }}
      onClick={(e) => {
        if (dismissible && e.target === ref.current) onClose?.(); // click on the backdrop
      }}
      aria-labelledby={title ? "ui-modal-title" : undefined}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-ui border border-border bg-surface p-0 text-fg shadow-2xl open:animate-ui-pop-in",
        sizes[size] || sizes.md,
        className
      )}
    >
      {open && (
        <div className="flex max-h-[calc(100dvh-4rem)] flex-col">
          {(title || dismissible) && (
            <div className="flex items-start justify-between gap-4 px-5 pt-5">
              <div className="grid gap-1">
                {title && <h2 id="ui-modal-title" className="text-lg font-semibold">{title}</h2>}
                {description && <p className="text-sm text-muted">{description}</p>}
              </div>
              {dismissible && (
                <button type="button" onClick={onClose} aria-label="Cerrar" className="-m-1 rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg">
                  <svg className="size-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
                </button>
              )}
            </div>
          )}
          {children != null && children !== false ? (
            <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">{children}</div>
          ) : (
            <div className="h-4" />
          )}
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** Convenience state hook: const modal = useDisclosure(); <Modal open={modal.open} onClose={modal.close} /> */
export function useDisclosure(initial = false) {
  const [open, setOpen] = useState(initial);
  return {
    open,
    onOpen: useCallback(() => setOpen(true), []),
    close: useCallback(() => setOpen(false), []),
    toggle: useCallback(() => setOpen((v) => !v), []),
    setOpen,
  };
}

const ConfirmContext = createContext(null);

/**
 * Enables `await confirm({...})` anywhere below it. Included in <UIProvider>.
 */
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      resolver.current = resolve;
      setState(typeof options === "string" ? { title: options } : options);
    });
  }, []);

  const finish = (value) => {
    resolver.current?.(value);
    resolver.current = null;
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={Boolean(state)}
        onClose={() => finish(false)}
        size="sm"
        title={state?.title ?? "¿Estás seguro?"}
        description={state?.description}
        footer={
          <>
            <Button variant="outline" onClick={() => finish(false)}>{state?.cancelText ?? "Cancelar"}</Button>
            <Button variant={state?.danger ? "danger" : "primary"} onClick={() => finish(true)} autoFocus>
              {state?.confirmText ?? "Confirmar"}
            </Button>
          </>
        }
      >
        {state?.content}
      </Modal>
    </ConfirmContext.Provider>
  );
}

/**
 * const confirm = useConfirm();
 * if (await confirm({ title: "¿Eliminar usuario?", description: "No se puede deshacer.", danger: true })) { ... }
 */
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm() requires <ConfirmProvider> or <UIProvider> in a parent layout.");
  return ctx;
}

export default Modal;
