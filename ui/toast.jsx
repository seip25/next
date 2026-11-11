"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./utils";

/*
 * Toasts (stacked notifications) and Snackbar (single bottom message with an action, e.g. "Deshacer").
 *
 *   <ToastProvider position="bottom-right">{children}</ToastProvider>   // or <UIProvider>
 *   const toast = useToast();
 *   toast.success("Guardado");  toast.error("Falló", { description: "..." });
 *   toast.promise(save(), { loading: "Guardando…", success: "Listo", error: (e) => e.message });
 *
 *   const snackbar = useSnackbar();
 *   snackbar.show("Mensaje eliminado", { action: { label: "Deshacer", onClick: undo } });
 *
 * Outside React (any client module): import { toast } from "@/ui/toast"; toast.info("Hola").
 */

const ToastContext = createContext(null);
const emitter = typeof window !== "undefined" ? (window.__seip_ui_toast ??= new EventTarget()) : null;
let counter = 0;

const tones = {
  default: "border-border",
  success: "border-success/40",
  error: "border-danger/40",
  warning: "border-warning/40",
  info: "border-info/40",
  loading: "border-border",
};

const icons = {
  success: <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" />,
  error: <path d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.7 7.3a1 1 0 0 0-1.4 1.4L8.6 10l-1.3 1.3a1 1 0 1 0 1.4 1.4l1.3-1.3 1.3 1.3a1 1 0 0 0 1.4-1.4L11.4 10l1.3-1.3a1 1 0 0 0-1.4-1.4L10 8.6 8.7 7.3Z" />,
  warning: <path d="M8.3 2.9a2 2 0 0 1 3.4 0l6.1 10.6A2 2 0 0 1 16.1 16.5H3.9a2 2 0 0 1-1.7-3L8.3 2.9ZM10 7a1 1 0 0 0-1 1v3a1 1 0 1 0 2 0V8a1 1 0 0 0-1-1Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />,
  info: <path d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm1-11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-2 2a1 1 0 0 0 0 2v3a1 1 0 0 0 1 1h1a1 1 0 1 0 0-2V10a1 1 0 0 0-1-1H9Z" />,
};
const iconColor = { success: "text-success", error: "text-danger", warning: "text-warning", info: "text-info" };

const positions = {
  "top-right": "top-4 right-4 items-end",
  "top-left": "top-4 left-4 items-start",
  "top-center": "top-4 left-1/2 -translate-x-1/2 items-center",
  "bottom-right": "bottom-4 right-4 items-end",
  "bottom-left": "bottom-4 left-4 items-start",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2 items-center",
};

function ToastItem({ t, onDismiss }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (t.type === "loading" || t.duration === Infinity || paused) return;
    const timer = setTimeout(() => onDismiss(t.id), t.duration);
    return () => clearTimeout(timer);
  }, [t, paused, onDismiss]);

  return (
    <div
      role={t.type === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={cn(
        "pointer-events-auto flex w-[min(24rem,calc(100vw-2rem))] items-start gap-3 rounded-ui border bg-surface p-4 text-sm text-fg shadow-lg animate-ui-slide-up",
        tones[t.type] || tones.default
      )}
    >
      {t.type === "loading" ? (
        <svg className="mt-0.5 size-5 shrink-0 animate-spin text-muted" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" /><path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /></svg>
      ) : icons[t.type] ? (
        <svg className={cn("mt-0.5 size-5 shrink-0", iconColor[t.type])} viewBox="0 0 20 20" fill="currentColor" fillRule="evenodd" clipRule="evenodd" aria-hidden="true">{icons[t.type]}</svg>
      ) : null}
      <div className="flex-1">
        <p className="font-medium">{t.message}</p>
        {t.description && <p className="mt-0.5 text-muted">{t.description}</p>}
        {t.action && (
          <button
            type="button"
            className="mt-2 text-sm font-semibold text-primary hover:underline"
            onClick={() => {
              t.action.onClick?.();
              onDismiss(t.id);
            }}
          >
            {t.action.label}
          </button>
        )}
      </div>
      <button type="button" aria-label="Cerrar" onClick={() => onDismiss(t.id)} className="-m-1 rounded p-1 text-muted hover:text-fg">
        <svg className="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
      </button>
    </div>
  );
}

function Snackbar({ item, onDismiss }) {
  useEffect(() => {
    if (!item || item.duration === Infinity) return;
    const timer = setTimeout(onDismiss, item.duration);
    return () => clearTimeout(timer);
  }, [item, onDismiss]);
  if (!item) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
      <div role="status" className="pointer-events-auto flex w-full max-w-lg items-center gap-4 rounded-ui bg-fg px-4 py-3 text-sm text-surface shadow-xl animate-ui-slide-up sm:w-auto sm:min-w-80">
        <span className="flex-1">{item.message}</span>
        {item.action && (
          <button
            type="button"
            className="font-semibold uppercase tracking-wide text-primary"
            onClick={() => {
              item.action.onClick?.();
              onDismiss();
            }}
          >
            {item.action.label}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * @param {{position?: keyof typeof positions, duration?: number, max?: number}} props
 */
export function ToastProvider({ position = "bottom-right", duration = 4000, max = 5, children }) {
  const [toasts, setToasts] = useState([]);
  const [snack, setSnack] = useState(null);
  const defaults = useRef({ duration });
  defaults.current.duration = duration;

  const dismiss = useCallback((id) => setToasts((list) => (id === undefined ? [] : list.filter((t) => t.id !== id))), []);

  const push = useCallback(
    (type, message, options = {}) => {
      const id = options.id ?? `t${++counter}`;
      const item = { id, type, message, duration: defaults.current.duration, ...options };
      setToasts((list) => {
        const exists = list.some((t) => t.id === id);
        const next = exists ? list.map((t) => (t.id === id ? item : t)) : [...list, item];
        return next.slice(-max);
      });
      return id;
    },
    [max]
  );

  const api = useMemo(() => {
    const toast = (message, options) => push("default", message, options);
    toast.success = (m, o) => push("success", m, o);
    toast.error = (m, o) => push("error", m, o);
    toast.warning = (m, o) => push("warning", m, o);
    toast.info = (m, o) => push("info", m, o);
    toast.loading = (m, o) => push("loading", m, o);
    toast.dismiss = dismiss;
    toast.promise = async (promise, msgs = {}) => {
      const id = push("loading", msgs.loading ?? "Cargando…");
      try {
        const value = await (typeof promise === "function" ? promise() : promise);
        const text = typeof msgs.success === "function" ? msgs.success(value) : msgs.success ?? "Listo";
        push("success", text, { id });
        return value;
      } catch (err) {
        const text = typeof msgs.error === "function" ? msgs.error(err) : msgs.error ?? "Ocurrió un error";
        push("error", text, { id });
        throw err;
      }
    };
    /** Shows the result of a Server Action: { success, message } or { errors } (Validator). */
    toast.fromResult = (result, okText = "Guardado") => {
      if (!result) return;
      if (result.success === false || result.error || result.errors?.length) {
        const msg = result.message?.[0] ?? result.errors?.[0]?.message ?? result.message ?? "Revisa los datos";
        return push("error", typeof msg === "string" ? msg : "Revisa los datos");
      }
      return push("success", typeof result.message === "string" ? result.message : okText);
    };
    const snackbar = {
      show: (message, options = {}) => setSnack({ message, duration: 5000, ...options, key: ++counter }),
      dismiss: () => setSnack(null),
    };
    return { toast, snackbar };
  }, [push, dismiss]);

  // Global imperative API: toast.success() from any client module.
  useEffect(() => {
    if (!emitter) return;
    const onToast = (e) => {
      const { type, message, options } = e.detail;
      if (type === "snackbar") api.snackbar.show(message, options);
      else if (type === "dismiss") api.toast.dismiss(message);
      else push(type, message, options);
    };
    emitter.addEventListener("toast", onToast);
    return () => emitter.removeEventListener("toast", onToast);
  }, [api, push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className={cn("pointer-events-none fixed z-[70] flex flex-col gap-2", positions[position] || positions["bottom-right"])}>
        {toasts.map((t) => (
          <ToastItem key={t.id} t={t} onDismiss={dismiss} />
        ))}
      </div>
      <Snackbar key={snack?.key} item={snack} onDismiss={api.snackbar.dismiss} />
    </ToastContext.Provider>
  );
}

/** Like useToast() but returns null (instead of throwing) when there is no provider. */
export function useToastOptional() {
  return useContext(ToastContext)?.toast ?? null;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() requires <ToastProvider> or <UIProvider> in a parent layout.");
  return ctx.toast;
}

export function useSnackbar() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useSnackbar() requires <ToastProvider> or <UIProvider> in a parent layout.");
  return ctx.snackbar;
}

const emit = (type) => (message, options) => emitter?.dispatchEvent(new CustomEvent("toast", { detail: { type, message, options } }));

/** Imperative API usable outside components (requires a mounted <ToastProvider>). */
export const toast = Object.assign(emit("default"), {
  success: emit("success"),
  error: emit("error"),
  warning: emit("warning"),
  info: emit("info"),
  loading: emit("loading"),
  dismiss: (id) => emit("dismiss")(id),
});
export const snackbar = { show: emit("snackbar") };

export default ToastProvider;
