import { cn } from "./utils";

/** Card container. Server-safe. `interactive` adds hover elevation (for clickable cards). */
export function Card({ className, interactive = false, as: Tag = "div", ...props }) {
  return (
    <Tag
      className={cn(
        "rounded-ui border border-border bg-surface text-fg shadow-sm",
        interactive && "transition-shadow hover:shadow-md",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, title, description, action, children, ...props }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 p-5 pb-0", className)} {...props}>
      <div className="grid gap-1">
        {title && <h3 className="text-base font-semibold leading-tight">{title}</h3>}
        {description && <p className="text-sm text-muted">{description}</p>}
        {children}
      </div>
      {action}
    </div>
  );
}

export function CardTitle({ className, as: Tag = "h3", ...props }) {
  return <Tag className={cn("text-base font-semibold leading-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }) {
  return <p className={cn("text-sm text-muted", className)} {...props} />;
}

export function CardBody({ className, ...props }) {
  return <div className={cn("p-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }) {
  return <div className={cn("flex items-center justify-end gap-2 border-t border-border px-5 py-3", className)} {...props} />;
}

/** KPI / stat card: <StatCard label="Ventas" value="$12.400" delta="+8%" trend="up" /> */
export function StatCard({ label, value, delta, trend, icon, className }) {
  return (
    <Card className={cn("p-5", className)}>
      <div className="flex items-center justify-between text-sm text-muted">
        <span>{label}</span>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      {delta && (
        <div className={cn("mt-1 text-xs font-medium", trend === "down" ? "text-danger" : trend === "up" ? "text-success" : "text-muted")}>
          {delta}
        </div>
      )}
    </Card>
  );
}

export default Card;
