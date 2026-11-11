import { useId } from "react";
import { cn, focusRing } from "./utils";

/** Checkbox with label and description. Server-safe; submits "on" (or `value`) in FormData. */
export function Checkbox({ id, label, description, error, className, ref, ...props }) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        aria-invalid={error ? true : undefined}
        className={cn("mt-0.5 size-4 shrink-0 cursor-pointer rounded border-border accent-primary disabled:cursor-not-allowed", focusRing)}
        {...props}
      />
      {(label || description || error) && (
        <div className="grid gap-0.5 text-sm">
          {label && <label htmlFor={inputId} className="cursor-pointer font-medium text-fg">{label}</label>}
          {description && <p className="text-muted">{description}</p>}
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}

/** Radio option. Group several with the same `name`. Server-safe. */
export function Radio({ id, label, description, className, ref, ...props }) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <input ref={ref} id={inputId} type="radio" className={cn("mt-0.5 size-4 shrink-0 cursor-pointer accent-primary", focusRing)} {...props} />
      <div className="grid gap-0.5 text-sm">
        {label && <label htmlFor={inputId} className="cursor-pointer font-medium text-fg">{label}</label>}
        {description && <p className="text-muted">{description}</p>}
      </div>
    </div>
  );
}

/**
 * Toggle switch (a styled checkbox with role="switch"). Server-safe.
 * Controlled: <Switch checked={on} onChange={(e) => setOn(e.target.checked)} />
 */
export function Switch({ id, label, description, className, size = "md", ref, ...props }) {
  const autoId = useId();
  const inputId = id || autoId;
  const track = size === "sm" ? "h-5 w-9" : "h-6 w-11";
  const thumb = size === "sm" ? "size-4 peer-checked:translate-x-4" : "size-5 peer-checked:translate-x-5";
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <span className={cn("relative inline-flex shrink-0", track)}>
        <input ref={ref} id={inputId} type="checkbox" role="switch" className="peer absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed" {...props} />
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-0 rounded-full bg-border transition-colors peer-checked:bg-primary peer-disabled:opacity-50",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface"
          )}
        />
        <span aria-hidden="true" className={cn("pointer-events-none absolute left-0.5 top-0.5 rounded-full bg-white shadow transition-transform", thumb)} />
      </span>
      {(label || description) && (
        <div className="grid gap-0.5 text-sm">
          {label && <label htmlFor={inputId} className="cursor-pointer font-medium text-fg">{label}</label>}
          {description && <p className="text-muted">{description}</p>}
        </div>
      )}
    </div>
  );
}

export default Checkbox;
