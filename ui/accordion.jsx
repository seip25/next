import { cn } from "./utils";

/**
 * Accordion built on native <details>/<summary>: accessible, works without JS. Server-safe.
 * Give every item the same `name` to make it exclusive (only one open at a time, modern browsers).
 * <Accordion items={[{ title: "¿Envíos?", content: "Sí, a todo el país." }]} name="faq" />
 */
export function Accordion({ items = [], name, className, children }) {
  return (
    <div className={cn("divide-y divide-border rounded-ui border border-border", className)}>
      {items.map((item, i) => (
        <AccordionItem key={item.id ?? i} title={item.title} name={name} defaultOpen={item.defaultOpen}>
          {item.content}
        </AccordionItem>
      ))}
      {children}
    </div>
  );
}

export function AccordionItem({ title, name, defaultOpen = false, className, children }) {
  return (
    <details name={name} open={defaultOpen || undefined} className={cn("group", className)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-medium text-fg hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        {title}
        <svg className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
        </svg>
      </summary>
      <div className="px-4 pb-4 text-sm text-muted">{children}</div>
    </details>
  );
}

export default Accordion;
