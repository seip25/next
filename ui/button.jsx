import { cn, focusRing } from "./utils";
import { Spinner } from "./spinner";

const variants = {
  primary: "bg-primary text-primary-fg hover:bg-primary/90 shadow-sm",
  secondary: "bg-surface-2 text-fg hover:bg-surface-2/70 border border-border",
  outline: "border border-border bg-transparent text-fg hover:bg-surface-2",
  ghost: "bg-transparent text-fg hover:bg-surface-2",
  danger: "bg-danger text-white hover:bg-danger/90 shadow-sm",
  success: "bg-success text-white hover:bg-success/90 shadow-sm",
  link: "bg-transparent text-primary underline-offset-4 hover:underline !px-0 !h-auto",
};

const sizes = {
  xs: "h-7 px-2.5 text-xs gap-1",
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
  icon: "size-10 p-0",
  "icon-sm": "size-8 p-0",
};

/**
 * Class names of a button. Use it to style links (server-safe):
 * <Link href="/new" className={buttonClasses({ variant: "outline" })}>Nuevo</Link>
 */
export function buttonClasses({ variant = "primary", size = "md", block = false, className } = {}) {
  return cn(
    "inline-flex items-center justify-center whitespace-nowrap rounded-ui font-medium transition-colors select-none",
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    focusRing,
    variants[variant] || variants.primary,
    sizes[size] || sizes.md,
    block && "w-full",
    className
  );
}

/**
 * Button. Server-safe (no hooks): works in Server Components and in <form action={serverAction}>.
 * @param {{variant?: "primary"|"secondary"|"outline"|"ghost"|"danger"|"success"|"link", size?: "xs"|"sm"|"md"|"lg"|"icon"|"icon-sm", block?: boolean, loading?: boolean, leftIcon?: any, rightIcon?: any}} props
 */
export function Button({
  variant,
  size,
  block,
  loading = false,
  disabled,
  leftIcon,
  rightIcon,
  className,
  children,
  type = "button",
  ref,
  ...props
}) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, block, className })}
      {...props}
    >
      {loading ? <Spinner size="sm" label="" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
}

export default Button;
