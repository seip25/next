"use client";
import { useEffect, useId, useRef, useState } from "react";
import { cn, focusRing } from "./utils";
import { Field } from "./input";

const formatSize = (bytes) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

/**
 * Drag & drop file input with previews and client-side checks (type, size, count).
 * The files stay in a real <input type="file" name=...>, so it works in a <form action={serverAction}>
 * and the action receives them with formData.get(name) / getAll(name) → Upload.save(file, {...}).
 * Client checks are UX only: always validate again on the server (Upload.save does).
 *
 * @param {{name: string, label?: any, hint?: any, error?: any, accept?: string, multiple?: boolean,
 *   maxSize?: number, maxFiles?: number, onFilesChange?: (files: File[]) => void, className?: string}} props
 */
export function FileUpload({ name, label, hint, error, accept, multiple = false, maxSize, maxFiles, onFilesChange, required, disabled, className }) {
  const id = useId();
  const input = useRef(null);
  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [previews, setPreviews] = useState({});

  useEffect(() => {
    const urls = {};
    files.forEach((f) => {
      if (f.type.startsWith("image/")) urls[f.name + f.size] = URL.createObjectURL(f);
    });
    setPreviews(urls);
    return () => Object.values(urls).forEach(URL.revokeObjectURL);
  }, [files]);

  const matchesAccept = (file) => {
    if (!accept) return true;
    return accept.split(",").some((rule) => {
      const r = rule.trim().toLowerCase();
      if (r.startsWith(".")) return file.name.toLowerCase().endsWith(r);
      if (r.endsWith("/*")) return file.type.startsWith(r.slice(0, -1));
      return file.type === r;
    });
  };

  const apply = (incoming) => {
    let next = multiple ? [...files, ...incoming] : incoming.slice(0, 1);
    let problem = null;
    next = next.filter((f) => {
      if (!matchesAccept(f)) return (problem = `Tipo no permitido: ${f.name}`), false;
      if (maxSize && f.size > maxSize) return (problem = `${f.name} supera ${formatSize(maxSize)}`), false;
      return true;
    });
    if (maxFiles && next.length > maxFiles) {
      problem = `Máximo ${maxFiles} archivo${maxFiles === 1 ? "" : "s"}`;
      next = next.slice(0, maxFiles);
    }
    setLocalError(problem);
    sync(next);
  };

  const sync = (next) => {
    setFiles(next);
    // Keep the real input in sync so a normal form submit includes the files.
    if (input.current && typeof DataTransfer !== "undefined") {
      const dt = new DataTransfer();
      next.forEach((f) => dt.items.add(f));
      input.current.files = dt.files;
    }
    onFilesChange?.(next);
  };

  const shownError = error || localError;

  return (
    <Field id={id} label={label} hint={hint} error={shownError} required={required} className={className}>
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) apply([...e.dataTransfer.files]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-ui border-2 border-dashed px-6 py-8 text-center text-sm transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-muted hover:bg-surface-2/50",
          shownError && "border-danger/60",
          disabled && "pointer-events-none opacity-60",
          "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
        )}
      >
        <svg className="size-8 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
        </svg>
        <span><span className="font-semibold text-primary">Elegí un archivo</span> o arrastralo aquí</span>
        {(accept || maxSize) && (
          <span className="text-xs text-muted">
            {accept && accept.replaceAll(",", ", ")}
            {accept && maxSize && " · "}
            {maxSize && `máx. ${formatSize(maxSize)}`}
          </span>
        )}
        <input
          ref={input}
          id={id}
          name={name}
          type="file"
          accept={accept}
          multiple={multiple}
          required={required && files.length === 0}
          disabled={disabled}
          className={cn("sr-only", focusRing)}
          onChange={(e) => apply([...e.target.files])}
        />
      </label>

      {files.length > 0 && (
        <ul className="mt-2 space-y-2">
          {files.map((f, i) => (
            <li key={f.name + f.size + i} className="flex items-center gap-3 rounded-ui border border-border p-2 text-sm">
              {previews[f.name + f.size] ? (
                <img src={previews[f.name + f.size]} alt="" className="size-10 rounded object-cover" />
              ) : (
                <span className="flex size-10 items-center justify-center rounded bg-surface-2 text-xs font-semibold uppercase text-muted">
                  {f.name.split(".").pop()?.slice(0, 4)}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{f.name}</span>
                <span className="text-xs text-muted">{formatSize(f.size)}</span>
              </span>
              <button
                type="button"
                aria-label={`Quitar ${f.name}`}
                onClick={() => sync(files.filter((_, j) => j !== i))}
                className="rounded p-1 text-muted hover:bg-surface-2 hover:text-danger"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </Field>
  );
}

export default FileUpload;
