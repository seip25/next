import { cn } from "./utils";

/** Placeholder block while content loads. Server-safe (ideal in loading.js). */
export function Skeleton({ className, ...props }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-ui bg-surface-2", className)} {...props} />;
}

/** Several text lines; the last one is shorter. */
export function SkeletonText({ lines = 3, className }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-4", i === lines - 1 && lines > 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

export default Skeleton;
