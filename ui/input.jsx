import { useId } from "react";
import { cn, focusRing } from "./utils";

export const controlClasses = cn(
  "w-full rounded-ui border border-border bg-surface px-3 text-sm text-fg placeholder:text-muted transition-colors",
  "disabled:cursor-not-allowed disabled:opacity-60 read-only:bg-surface-2",
  "aria-invalid:border-danger aria-invalid:focus-visible:ring-danger",
  focusRing
);

/**
 * Label + control + hint/error wrapper. Server-safe.
 * Used by Input, Textarea, Select and FileUpload; use it for your own controls too.
 */
export function Field({ id, label, hint, error, required, className, children }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {label}
          {required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

function describedBy(id, error, hint) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

/**
 * Text input with label, hint, error and icons. Server-safe: usable directly in a
 * Server Component form. Pair it with errorFor(state.errors, "email") from ./utils.
 */
export function Input({ id, label, hint, error, leftIcon, rightIcon, className, inputClassName, size = "md", required, ref, ...props }) {
  const autoId = useId();
  const inputId = id || props.name || autoId;
  const height = size === "sm" ? "h-8" : size === "lg" ? "h-12 text-base" : "h-10";
  return (
    <Field id={inputId} label={label} hint={hint} error={error} required={required} className={className}>
      <div className="relative">
        {leftIcon && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">{leftIcon}</span>}
        <input
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(inputId, error, hint)}
          className={cn(controlClasses, height, leftIcon && "pl-9", rightIcon && "pr-9", inputClassName)}
          {...props}
        />
        {rightIcon && <span className="absolute inset-y-0 right-3 flex items-center text-muted">{rightIcon}</span>}
      </div>
    </Field>
  );
}

/** Multi-line text. Server-safe. */
export function Textarea({ id, label, hint, error, className, inputClassName, rows = 4, required, ref, ...props }) {
  const autoId = useId();
  const inputId = id || props.name || autoId;
  return (
    <Field id={inputId} label={label} hint={hint} error={error} required={required} className={className}>
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, error, hint)}
        className={cn(controlClasses, "py-2 resize-y min-h-20", inputClassName)}
        {...props}
      />
    </Field>
  );
}

export default Input;
