import { cn } from "./utils";

const tones = {
  info: "border-info/30 bg-info/10 text-info",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-danger/30 bg-danger/10 text-danger",
  neutral: "border-border bg-surface-2 text-fg",
};

/** Inline message banner. Server-safe. <Alert tone="danger" title="Error">{state.message}</Alert> */
export function Alert({ tone = "info", title, icon, action, className, children, ...props }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-3 rounded-ui border p-4 text-sm", tones[tone] || tones.info, className)} {...props}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="flex-1 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-fg/80">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export default Alert;
