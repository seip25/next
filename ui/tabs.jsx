"use client";
import { useId, useRef, useState } from "react";
import { cn, focusRing } from "./utils";

/**
 * Accessible tabs (arrow keys, Home/End). Controlled (`value` + `onChange`) or uncontrolled.
 * <Tabs tabs={[{ id: "perfil", label: "Perfil", content: <Perfil /> }, { id: "pagos", label: "Pagos", content: <Pagos /> }]} />
 * @param {{tabs: Array<{id: string, label: any, content?: any, disabled?: boolean, badge?: any}>, value?: string, defaultValue?: string,
 *   onChange?: (id: string) => void, variant?: "underline"|"pills", className?: string}} props
 */
export function Tabs({ tabs = [], value, defaultValue, onChange, variant = "underline", className, panelClassName }) {
  const baseId = useId();
  const [internal, setInternal] = useState(defaultValue ?? tabs[0]?.id);
  const active = value ?? internal;
  const refs = useRef({});

  const select = (id) => {
    if (value === undefined) setInternal(id);
    onChange?.(id);
  };

  const onKeyDown = (e) => {
    const enabled = tabs.filter((t) => !t.disabled);
    const idx = enabled.findIndex((t) => t.id === active);
    let next = null;
    if (e.key === "ArrowRight") next = enabled[(idx + 1) % enabled.length];
    if (e.key === "ArrowLeft") next = enabled[(idx - 1 + enabled.length) % enabled.length];
    if (e.key === "Home") next = enabled[0];
    if (e.key === "End") next = enabled[enabled.length - 1];
    if (next) {
      e.preventDefault();
      select(next.id);
      refs.current[next.id]?.focus();
    }
  };

  const current = tabs.find((t) => t.id === active);

  return (
    <div className={className}>
      <div
        role="tablist"
        onKeyDown={onKeyDown}
        className={cn("flex gap-1 overflow-x-auto", variant === "underline" ? "border-b border-border" : "rounded-ui bg-surface-2 p-1")}
      >
        {tabs.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => (refs.current[t.id] = el)}
              role="tab"
              type="button"
              id={`${baseId}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={t.disabled}
              onClick={() => select(t.id)}
              className={cn(
                "inline-flex items-center gap-2 whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50",
                focusRing,
                variant === "underline"
                  ? cn("-mb-px border-b-2", selected ? "border-primary text-fg" : "border-transparent text-muted hover:text-fg")
                  : cn("rounded-[calc(var(--ui-radius)-2px)]", selected ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg")
              )}
            >
              {t.label}
              {t.badge}
            </button>
          );
        })}
      </div>
      {current?.content !== undefined && (
        <div role="tabpanel" id={`${baseId}-panel-${active}`} aria-labelledby={`${baseId}-tab-${active}`} tabIndex={0} className={cn("pt-4 outline-none", panelClassName)}>
          {current.content}
        </div>
      )}
    </div>
  );
}

export default Tabs;
