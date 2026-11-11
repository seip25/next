import { cn } from "./utils";

/** Empty / no-results placeholder. Server-safe. */
export function EmptyState({ icon, title = "Sin resultados", description, action, className }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      {icon && <div className="mb-2 text-muted [&>svg]:size-10">{icon}</div>}
      <p className="text-base font-semibold text-fg">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export default EmptyState;
