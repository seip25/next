import { cn } from "./utils";

const sizes = { xs: "size-3", sm: "size-4", md: "size-6", lg: "size-8", xl: "size-12" };

/** Loading spinner. Server-safe. */
export function Spinner({ size = "md", className, label = "Cargando", ...props }) {
  return (
    <span role="status" aria-label={label} className={cn("inline-flex", className)} {...props}>
      <svg className={cn("animate-spin", sizes[size] || sizes.md)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
        <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export default Spinner;
