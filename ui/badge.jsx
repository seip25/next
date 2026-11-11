import { cn } from "./utils";

const tones = {
  neutral: "bg-surface-2 text-fg border-border",
  primary: "bg-primary/10 text-primary border-primary/20",
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  danger: "bg-danger/10 text-danger border-danger/20",
  info: "bg-info/10 text-info border-info/20",
};

/** Status pill. Server-safe. <Badge tone="success" dot>Activo</Badge> */
export function Badge({ tone = "neutral", dot = false, className, children, ...props }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium", tones[tone] || tones.neutral, className)}
      {...props}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

export default Badge;
