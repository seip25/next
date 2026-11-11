import { cn } from "./utils";

const sides = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

/**
 * CSS-only tooltip (hover and keyboard focus). Server-safe, zero JS.
 * <Tooltip content="Eliminar"><Button size="icon">🗑</Button></Tooltip>
 */
export function Tooltip({ content, side = "top", className, children }) {
  return (
    <span className="group/tooltip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 w-max max-w-xs rounded-md bg-fg px-2 py-1 text-xs text-surface opacity-0 shadow transition-opacity",
          "group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100",
          sides[side] || sides.top,
          className
        )}
      >
        {content}
      </span>
    </span>
  );
}

export default Tooltip;
