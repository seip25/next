import { useId } from "react";
import { cn } from "./utils";
import { Field, controlClasses } from "./input";

/**
 * Native <select> (accessible, works on mobile and inside Server Action forms). Server-safe.
 * @param {{options?: Array<string|{value: any, label: string, disabled?: boolean}>, placeholder?: string}} props
 */
export function Select({ id, label, hint, error, options = [], placeholder, className, inputClassName, size = "md", required, children, ref, ...props }) {
  const autoId = useId();
  const selectId = id || props.name || autoId;
  const height = size === "sm" ? "h-8" : size === "lg" ? "h-12 text-base" : "h-10";
  return (
    <Field id={selectId} label={label} hint={hint} error={error} required={required} className={className}>
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined}
          className={cn(controlClasses, height, "appearance-none pr-9", inputClassName)}
          {...props}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((opt) => {
            const o = typeof opt === "object" ? opt : { value: opt, label: String(opt) };
            return (
              <option key={String(o.value)} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            );
          })}
          {children}
        </select>
        <svg className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
        </svg>
      </div>
    </Field>
  );
}

export default Select;
