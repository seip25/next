"use client";
import { cn, focusRing } from "./utils";

/** Page numbers with ellipsis: [1, "…", 4, 5, 6, "…", 20] */
export function pageRange(page, totalPages, siblings = 1) {
  const total = Math.max(1, totalPages);
  const start = Math.max(2, page - siblings);
  const end = Math.min(total - 1, page + siblings);
  const pages = [1];
  if (start > 2) pages.push("…");
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < total - 1) pages.push("…");
  if (total > 1) pages.push(total);
  return pages;
}

/**
 * Pagination. Two modes:
 *  - callbacks: <Pagination page={page} totalPages={10} onPageChange={setPage} />
 *  - links (SEO / Server Components data): <Pagination page={2} totalPages={10} href={(p) => `?page=${p}`} />
 */
export function Pagination({ page = 1, totalPages = 1, onPageChange, href, siblings = 1, className, compact = false }) {
  if (totalPages <= 1) return null;
  const go = (p) => onPageChange?.(Math.min(totalPages, Math.max(1, p)));
  const btn = (active) =>
    cn(
      "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm transition-colors",
      focusRing,
      active ? "bg-primary text-primary-fg" : "text-fg hover:bg-surface-2",
      "aria-disabled:pointer-events-none aria-disabled:opacity-40"
    );

  const Item = ({ p, children, label, disabled, active }) =>
    href ? (
      <a href={disabled ? undefined : href(p)} aria-label={label} aria-current={active ? "page" : undefined} aria-disabled={disabled || undefined} className={btn(active)}>
        {children}
      </a>
    ) : (
      <button type="button" onClick={() => go(p)} aria-label={label} aria-current={active ? "page" : undefined} aria-disabled={disabled || undefined} disabled={disabled} className={btn(active)}>
        {children}
      </button>
    );

  return (
    <nav aria-label="Paginación" className={cn("flex items-center gap-1", className)}>
      <Item p={page - 1} label="Anterior" disabled={page <= 1}>‹</Item>
      {compact ? (
        <span className="px-2 text-sm text-muted tabular-nums">{page} / {totalPages}</span>
      ) : (
        pageRange(page, totalPages, siblings).map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="px-1 text-muted">…</span>
          ) : (
            <Item key={p} p={p} active={p === page} label={`Página ${p}`}>{p}</Item>
          )
        )
      )}
      <Item p={page + 1} label="Siguiente" disabled={page >= totalPages}>›</Item>
    </nav>
  );
}

export default Pagination;
