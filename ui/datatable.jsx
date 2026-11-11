"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn, focusRing } from "./utils";
import { Input } from "./input";
import { Select } from "./select";
import { Button } from "./button";
import { Pagination } from "./pagination";
import { Skeleton } from "./skeleton";
import { EmptyState } from "./empty-state";
import { Spinner } from "./spinner";

/*
 * Responsive DataTable: search, column filters, sorting, pagination, row selection, CSV export.
 * Desktop renders a <table>; below `md` every row becomes a card (no horizontal scroll).
 *
 * Modes
 *  - "client" (default): pass all rows in `data`; everything happens in the browser.
 *  - "url": state lives in the URL (?q=&page=&limit=&sort=&dir=&f_<col>=). The Server Component page
 *           reads it with TableQuery.parse(searchParams) and passes `data`, `total` and `query`.
 *           Shareable links, back button and SSR work out of the box.
 *  - "server": controlled; you get onQueryChange(query) and pass `data`, `total`, `loading`.
 *
 * Column definition
 *  { key: "email", header: "Email", sortable: true, searchable: true,
 *    filter: { type: "select", options: ["admin", "user"] | [{ value, label }] | "auto" } | { type: "text" },
 *    render: (row, value) => <a href={`mailto:${value}`}>{value}</a>,
 *    accessor: (row) => row.profile.email,   // computed value (client mode)
 *    exportValue: (row) => row.email,       // CSV value
 *    align: "left" | "center" | "right", width: "8rem", primary: true (card title on mobile),
 *    hideOnMobile: true, className, headerClassName }
 */

const DEFAULT_LABELS = {
  search: "Buscar…",
  all: "Todos",
  rowsPerPage: "Filas",
  showing: (from, to, total) => `Mostrando ${from}–${to} de ${total}`,
  empty: "Sin resultados",
  emptyDescription: "Prueba con otra búsqueda o quita filtros.",
  export: "Exportar CSV",
  selected: (n) => `${n} seleccionado${n === 1 ? "" : "s"}`,
  clear: "Limpiar filtros",
};

const getValue = (row, col) => (col.accessor ? col.accessor(row) : row?.[col.key]);

function compare(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v == null ? "" : v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cols = columns.filter((c) => c.export !== false && c.key);
  const head = cols.map((c) => esc(typeof c.header === "string" ? c.header : c.key)).join(",");
  const body = rows.map((r) => cols.map((c) => esc(c.exportValue ? c.exportValue(r) : getValue(r, c))).join(","));
  return "﻿" + [head, ...body].join("\n");
}

function downloadCsv(filename, content) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function queryToSearch(query, baseSearch = "") {
  const params = new URLSearchParams(baseSearch);
  for (const key of [...params.keys()]) {
    if (["q", "page", "limit", "sort", "dir"].includes(key) || key.startsWith("f_")) params.delete(key);
  }
  if (query.search) params.set("q", query.search);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.limit) params.set("limit", String(query.limit));
  if (query.sort) {
    params.set("sort", query.sort);
    params.set("dir", query.dir || "asc");
  }
  for (const [k, v] of Object.entries(query.filters || {})) if (v !== "" && v != null) params.set(`f_${k}`, String(v));
  const s = params.toString();
  return s ? `?${s}` : "";
}

/**
 * @param {{
 *   columns: any[], data?: any[], rowKey?: string | ((row: any) => any), mode?: "client"|"url"|"server",
 *   total?: number, query?: {page?: number, limit?: number, search?: string, sort?: string, dir?: "asc"|"desc", filters?: Record<string, any>},
 *   onQueryChange?: (q: any) => void, loading?: boolean, searchable?: boolean, pageSize?: number, pageSizeOptions?: number[],
 *   selectable?: boolean, onSelectionChange?: (rows: any[]) => void, bulkActions?: (rows: any[], clear: () => void) => any,
 *   actions?: any, exportable?: boolean | string, onRowClick?: (row: any) => void, emptyState?: any,
 *   dense?: boolean, striped?: boolean, stickyHeader?: boolean, labels?: Partial<typeof DEFAULT_LABELS>, className?: string, caption?: string
 * }} props
 */
export function DataTable({
  columns = [],
  data = [],
  rowKey = "id",
  mode = "client",
  total: totalProp,
  query: initialQuery,
  onQueryChange,
  loading: loadingProp = false,
  searchable = true,
  pageSize = 10,
  pageSizeOptions = [10, 25, 50, 100],
  selectable = false,
  onSelectionChange,
  bulkActions,
  actions,
  exportable = false,
  onRowClick,
  emptyState,
  dense = false,
  striped = false,
  stickyHeader = false,
  labels: labelsProp,
  className,
  caption,
}) {
  const labels = { ...DEFAULT_LABELS, ...labelsProp };
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const loading = loadingProp || isPending;

  const [query, setQuery] = useState(() => ({
    page: 1,
    limit: pageSize,
    search: "",
    sort: null,
    dir: "asc",
    filters: {},
    ...initialQuery,
  }));
  const [searchInput, setSearchInput] = useState(query.search || "");
  const [selected, setSelected] = useState(() => new Set());
  const first = useRef(true);

  const keyOf = (row, i) => (typeof rowKey === "function" ? rowKey(row) : row?.[rowKey] ?? i);

  // Debounced search.
  useEffect(() => {
    if (searchInput === (query.search || "")) return;
    const t = setTimeout(() => setQuery((q) => ({ ...q, search: searchInput, page: 1 })), mode === "client" ? 150 : 350);
    return () => clearTimeout(t);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  // Propagate query changes in url/server modes (skip the initial render: the server already sent page 1).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (mode === "url") {
      startTransition(() => router.replace(`${pathname}${queryToSearch(query, window.location.search)}`, { scroll: false }));
    } else if (mode === "server") {
      onQueryChange?.(query);
    }
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  // Client-side pipeline.
  const processed = useMemo(() => {
    if (mode !== "client") return data;
    let rows = data;
    const term = (query.search || "").trim().toLowerCase();
    if (term) {
      const searchCols = columns.filter((c) => c.searchable !== false && (c.key || c.accessor));
      rows = rows.filter((r) => searchCols.some((c) => String(getValue(r, c) ?? "").toLowerCase().includes(term)));
    }
    for (const [key, value] of Object.entries(query.filters || {})) {
      if (value === "" || value == null) continue;
      const col = columns.find((c) => c.key === key);
      if (!col) continue;
      rows =
        col.filter?.type === "text"
          ? rows.filter((r) => String(getValue(r, col) ?? "").toLowerCase().includes(String(value).toLowerCase()))
          : rows.filter((r) => String(getValue(r, col) ?? "") === String(value));
    }
    if (query.sort) {
      const col = columns.find((c) => c.key === query.sort);
      if (col) {
        const factor = query.dir === "desc" ? -1 : 1;
        rows = [...rows].sort((a, b) => (col.sortFn ? col.sortFn(a, b) : compare(getValue(a, col), getValue(b, col))) * factor);
      }
    }
    return rows;
  }, [data, columns, query, mode]);

  const total = mode === "client" ? processed.length : totalProp ?? data.length;
  const totalPages = Math.max(1, Math.ceil(total / query.limit));
  const page = Math.min(query.page, totalPages);
  const rows = mode === "client" ? processed.slice((page - 1) * query.limit, page * query.limit) : data;
  const from = total === 0 ? 0 : (page - 1) * query.limit + 1;
  const to = Math.min(total, page * query.limit);

  const update = (patch) => setQuery((q) => ({ ...q, ...patch }));
  const toggleSort = (col) => {
    if (!col.sortable) return;
    setQuery((q) =>
      q.sort !== col.key ? { ...q, sort: col.key, dir: "asc" } : q.dir === "asc" ? { ...q, dir: "desc" } : { ...q, sort: null, dir: "asc" }
    );
  };

  // Selection (keys are kept across pages; rows are resolved from the data we know).
  const selectedRows = useMemo(() => data.filter((r, i) => selected.has(keyOf(r, i))), [data, selected]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    onSelectionChange?.(selectedRows);
  }, [selectedRows]); // eslint-disable-line react-hooks/exhaustive-deps
  const pageKeys = rows.map((r, i) => keyOf(r, i));
  const allOnPage = pageKeys.length > 0 && pageKeys.every((k) => selected.has(k));
  const toggleAll = () =>
    setSelected((s) => {
      const next = new Set(s);
      pageKeys.forEach((k) => (allOnPage ? next.delete(k) : next.add(k)));
      return next;
    });
  const toggleOne = (k) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  const clearSelection = () => setSelected(new Set());

  const filterCols = columns.filter((c) => c.filter);
  const hasActiveFilters = Boolean(query.search) || Object.values(query.filters || {}).some((v) => v !== "" && v != null);
  const filterOptions = (col) => {
    if (col.filter.options !== "auto") return col.filter.options || [];
    const values = new Set(data.map((r) => getValue(r, col)).filter((v) => v !== null && v !== undefined && v !== ""));
    return [...values].sort(compare).map(String);
  };

  const align = (col) => (col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left");
  const cell = (row, col) => {
    const value = getValue(row, col);
    return col.render ? col.render(row, value) : value == null || value === "" ? <span className="text-muted">—</span> : String(value);
  };
  const pad = dense ? "px-3 py-1.5" : "px-4 py-3";
  const primaryCol = columns.find((c) => c.primary) || columns[0];

  const exportCsv = () => {
    const name = typeof exportable === "string" ? exportable : "export.csv";
    downloadCsv(name.endsWith(".csv") ? name : `${name}.csv`, toCsv(mode === "client" ? processed : rows, columns));
  };

  const SortIcon = ({ col }) => {
    const active = query.sort === col.key;
    return (
      <svg className={cn("size-3.5 shrink-0", active ? "text-fg" : "text-muted/60")} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        {active && query.dir === "desc" ? (
          <path d="M10 14l-4-5h8l-4 5Z" />
        ) : active ? (
          <path d="M10 6l4 5H6l4-5Z" />
        ) : (
          <path d="M10 3l3.5 4.5h-7L10 3Zm0 14l-3.5-4.5h7L10 17Z" />
        )}
      </svg>
    );
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Toolbar */}
      {(searchable || filterCols.length > 0 || actions || exportable) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          {searchable && (
            <Input
              type="search"
              aria-label={labels.search}
              placeholder={labels.search}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="sm:w-64"
              leftIcon={
                <svg className="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.45 4.39l3.08 3.08a.75.75 0 1 1-1.06 1.06l-3.08-3.08A7 7 0 0 1 2 9Z" clipRule="evenodd" /></svg>
              }
            />
          )}
          {filterCols.map((col) =>
            col.filter.type === "text" ? (
              <Input
                key={col.key}
                aria-label={col.filter.label || col.header}
                placeholder={col.filter.label || (typeof col.header === "string" ? col.header : col.key)}
                value={query.filters?.[col.key] ?? ""}
                onChange={(e) => update({ filters: { ...query.filters, [col.key]: e.target.value }, page: 1 })}
                className="sm:w-44"
              />
            ) : (
              <Select
                key={col.key}
                aria-label={col.filter.label || col.header}
                placeholder={`${col.filter.label || col.header}: ${labels.all}`}
                options={filterOptions(col)}
                value={query.filters?.[col.key] ?? ""}
                onChange={(e) => update({ filters: { ...query.filters, [col.key]: e.target.value }, page: 1 })}
                className="sm:w-48"
              />
            )
          )}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start sm:self-auto sm:mb-1"
              onClick={() => {
                setSearchInput("");
                update({ search: "", filters: {}, page: 1 });
              }}
            >
              {labels.clear}
            </Button>
          )}
          <div className="flex items-center gap-2 sm:ml-auto">
            {loading && <Spinner size="sm" />}
            {exportable && (
              <Button variant="outline" size="sm" onClick={exportCsv}>
                {labels.export}
              </Button>
            )}
            {actions}
          </div>
        </div>
      )}

      {/* Bulk actions */}
      {selectable && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-ui border border-primary/30 bg-primary/5 px-4 py-2 text-sm">
          <span className="font-medium">{labels.selected(selected.size)}</span>
          {bulkActions?.(selectedRows, clearSelection)}
          <button type="button" className="ml-auto text-muted hover:text-fg" onClick={clearSelection}>✕</button>
        </div>
      )}

      <div className={cn("relative rounded-ui border border-border bg-surface", loading && rows.length > 0 && "opacity-60 transition-opacity")}>
        {/* Desktop table */}
        <div className={cn("hidden overflow-x-auto md:block", stickyHeader && "max-h-[70vh] overflow-y-auto")}>
          <table className="w-full border-collapse text-sm">
            {caption && <caption className="sr-only">{caption}</caption>}
            <thead className={cn("bg-surface-2/60 text-xs uppercase tracking-wide text-muted", stickyHeader && "sticky top-0 z-10 bg-surface-2")}>
              <tr>
                {selectable && (
                  <th className={cn(pad, "w-10")}>
                    <input type="checkbox" aria-label="Seleccionar página" checked={allOnPage} onChange={toggleAll} className="size-4 accent-primary" />
                  </th>
                )}
                {columns.map((col) => (
                  <th
                    key={col.key ?? col.header}
                    scope="col"
                    style={col.width ? { width: col.width } : undefined}
                    aria-sort={query.sort === col.key ? (query.dir === "desc" ? "descending" : "ascending") : undefined}
                    className={cn(pad, "font-medium", align(col), col.headerClassName)}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        className={cn("inline-flex items-center gap-1 rounded uppercase hover:text-fg", focusRing, col.align === "right" && "flex-row-reverse")}
                      >
                        {col.header}
                        <SortIcon col={col} />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && rows.length === 0
                ? Array.from({ length: Math.min(query.limit, 5) }, (_, i) => (
                    <tr key={`s${i}`}>
                      {selectable && <td className={pad} />}
                      {columns.map((col) => (
                        <td key={col.key ?? col.header} className={pad}>
                          <Skeleton className="h-4 w-3/4" />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map((row, i) => {
                    const k = keyOf(row, i);
                    return (
                      <tr
                        key={k}
                        onClick={onRowClick ? () => onRowClick(row) : undefined}
                        className={cn(
                          "transition-colors hover:bg-surface-2/50",
                          striped && "even:bg-surface-2/30",
                          onRowClick && "cursor-pointer",
                          selected.has(k) && "bg-primary/5"
                        )}
                      >
                        {selectable && (
                          <td className={pad} onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" aria-label="Seleccionar fila" checked={selected.has(k)} onChange={() => toggleOne(k)} className="size-4 accent-primary" />
                          </td>
                        )}
                        {columns.map((col) => (
                          <td key={col.key ?? col.header} className={cn(pad, align(col), col.className)}>
                            {cell(row, col)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <ul className="divide-y divide-border md:hidden">
          {loading && rows.length === 0
            ? Array.from({ length: 3 }, (_, i) => (
                <li key={`s${i}`} className="space-y-2 p-4">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-3/4" />
                </li>
              ))
            : rows.map((row, i) => {
                const k = keyOf(row, i);
                return (
                  <li
                    key={k}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn("p-4", onRowClick && "cursor-pointer active:bg-surface-2", selected.has(k) && "bg-primary/5")}
                  >
                    <div className="mb-2 flex items-start gap-3">
                      {selectable && (
                        <input
                          type="checkbox"
                          aria-label="Seleccionar fila"
                          checked={selected.has(k)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleOne(k)}
                          className="mt-0.5 size-4 accent-primary"
                        />
                      )}
                      <div className="flex-1 font-medium">{primaryCol && cell(row, primaryCol)}</div>
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                      {columns
                        .filter((c) => c !== primaryCol && !c.hideOnMobile)
                        .map((col) => (
                          <div key={col.key ?? col.header} className="contents">
                            <dt className="text-muted">{col.header}</dt>
                            <dd className="min-w-0 break-words text-right">{cell(row, col)}</dd>
                          </div>
                        ))}
                    </dl>
                  </li>
                );
              })}
        </ul>

        {!loading && rows.length === 0 && (emptyState ?? <EmptyState title={labels.empty} description={hasActiveFilters ? labels.emptyDescription : undefined} />)}
      </div>

      {/* Footer */}
      <div className="flex flex-col-reverse items-center justify-between gap-3 text-sm text-muted sm:flex-row">
        <div className="flex items-center gap-3">
          <span className="tabular-nums">{labels.showing(from, to, total)}</span>
          {pageSizeOptions?.length > 1 && (
            <Select
              aria-label={labels.rowsPerPage}
              size="sm"
              value={query.limit}
              options={pageSizeOptions}
              onChange={(e) => update({ limit: Number(e.target.value), page: 1 })}
              className="w-20"
            />
          )}
        </div>
        <Pagination page={page} totalPages={totalPages} onPageChange={(p) => update({ page: p })} />
      </div>
    </div>
  );
}

export default DataTable;
