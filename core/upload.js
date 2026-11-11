import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import Config from "./config.js";

import { importOptionalDefault } from "./util/optional.js";

const multer = await importOptionalDefault("multer");

/** Canonical, safe extension per MIME type. Prevents storing uploads under executable extensions. */
const MIME_EXTENSIONS = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "application/pdf": ".pdf",
  "application/json": ".json",
  "application/zip": ".zip",
  "application/gzip": ".gz",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

/** Reverse map used when serving files. */
const EXTENSION_MIME = Object.fromEntries(
  Object.entries(MIME_EXTENSIONS)
    .filter(([mime]) => mime !== "image/jpg")
    .map(([mime, ext]) => [ext, mime])
);

/** Types safe to render inline; everything else is served as a download. */
const INLINE_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp",
  "application/pdf", "audio/mpeg", "audio/wav", "audio/ogg", "video/mp4", "video/webm", "video/quicktime",
]);

/** Extensions that must never be written into a public/static directory. */
const BLOCKED_EXTENSIONS = new Set([
  ".html", ".htm", ".xhtml", ".shtml", ".svg", ".svgz", ".xml", ".xsl", ".xslt",
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
  ".php", ".phtml", ".php3", ".php4", ".php5", ".phar",
  ".exe", ".dll", ".bat", ".cmd", ".com", ".msi", ".scr", ".ps1", ".psm1", ".vbs", ".wsf", ".hta",
  ".sh", ".bash", ".zsh", ".py", ".rb", ".pl", ".cgi",
  ".jar", ".war", ".wasm", ".swf",
  ".htaccess", ".htpasswd",
]);

function sanitizeExtension(ext) {
  const clean = String(ext || "").trim().toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(clean) ? clean : "";
}

/**
 * Validates a folder option and returns it normalized with forward slashes.
 * Rejects traversal segments, absolute paths and separators.
 * @param {string} [folder="uploads"]
 * @returns {string}
 */
function safeFolder(folder = "uploads") {
  const raw = String(folder ?? "uploads").trim();
  if (!raw) return "uploads";
  // Reject absolute paths and drive-letter prefixes outright.
  if (/^[\\/]/.test(raw) || /^[a-zA-Z]:/.test(raw)) {
    throw new Error(`[UPLOAD ERROR] Invalid upload folder '${folder}'. Absolute paths are not allowed.`);
  }
  const segments = raw.split(/[\\/]+/).filter((segment) => segment.length > 0);
  if (segments.length === 0) return "uploads";
  for (const segment of segments) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(segment)) {
      throw new Error(
        `[UPLOAD ERROR] Invalid upload folder '${folder}'. Only alphanumeric, '_' and '-' segments are allowed.`
      );
    }
  }
  return segments.join("/");
}

function resolveSafeDestination(baseDir, relativeDir) {
  const base = path.resolve(baseDir);
  const dest = path.resolve(base, relativeDir);
  const rel = path.relative(base, dest);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("[UPLOAD ERROR] Destination escapes the upload base directory.");
  }
  return dest;
}

/**
 * File upload helper supporting native Next.js Server Actions / FormData,
 * Desktop persistent userData directory, and optional multer fallback.
 */
class Upload {
  static _ensureMulter() {
    if (!multer) {
      console.error(
        "[UPLOAD ERROR] install multer via npm or bun ('npm install multer' or 'bun add multer')"
      );
      throw new Error(
        "[UPLOAD ERROR] 'multer' package is not installed. Install it with: npm install multer"
      );
    }
  }

  /**
   * Resolves target destination directory.
   * In desktop mode, redirects to Config.userDataDir() to avoid EROFS inside .asar.
   * In web/VPS mode, saves to public/<folder>.
   * @param {string} [folder="uploads"]
   * @returns {string}
   */
  static getDestination(folder = "uploads") {
    const safe = safeFolder(folder);
    const isDesktop = Config.isDesktop();
    const baseDir = isDesktop ? Config.userDataDir() : path.resolve(Config.appDir(), "public");
    const relativeDir = isDesktop
      ? (safe === "uploads" || safe.startsWith("uploads/") ? safe : `uploads/${safe}`)
      : safe;
    const dest = resolveSafeDestination(baseDir, relativeDir);

    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    return dest;
  }

  /**
   * Saves a File/Blob uploaded via Next.js FormData in Server Actions or Route Handlers.
   * Zero-dependency native stream saving.
   *
   * Note: Server Actions reject bodies over 1MB by default before this code runs.
   * Raise `experimental.serverActions.bodySizeLimit` in next.config.js (e.g. "10mb")
   * or upload through a Route Handler. Runtime uploads under public/ are not served by
   * `next start`: use nginx (nginx:conf) or `Upload.serve()` in a Route Handler.
   * @param {File|Blob} file
   * @param {Object} [options={}]
   * @param {string} [options.folder="uploads"]
   * @param {number} [options.maxSize=10485760] - 10MB
   * @param {string[]} [options.allowedTypes=[]]
   * @returns {Promise<{filename: string, url: string, path: string, size: number, mimeType: string}>}
   */
  static async save(file, options = {}) {
    if (!file || typeof file.arrayBuffer !== "function") {
      throw new Error("[UPLOAD ERROR] Invalid file provided.");
    }

    const {
      folder = "uploads",
      maxSize = 10 * 1024 * 1024,
      allowedTypes = [],
      allowDangerousExtensions = false,
    } = options;

    if (!file.size || file.size === 0) {
      throw new Error("[UPLOAD ERROR] Provided file is empty (0 bytes).");
    }

    if (file.size > maxSize) {
      throw new Error(`[UPLOAD ERROR] File size exceeds maximum limit of ${maxSize} bytes.`);
    }

    if (allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
      throw new Error(`[UPLOAD ERROR] File type '${file.type}' is not allowed.`);
    }

    const originalName = file.name || "upload.bin";
    const mimeType = String(file.type || "").toLowerCase();
    const mappedExt = MIME_EXTENSIONS[mimeType] || "";
    let ext = mappedExt || sanitizeExtension(path.extname(originalName));
    if (!ext) ext = ".bin";

    if (!mappedExt && BLOCKED_EXTENSIONS.has(ext) && !allowDangerousExtensions) {
      throw new Error(
        `[UPLOAD ERROR] File extension '${ext}' is not allowed for security reasons. ` +
          "Pass { allowDangerousExtensions: true } only if you serve uploads with a safe Content-Type and nosniff."
      );
    }

    const safe = safeFolder(folder);
    const filename = `${randomUUID()}${ext}`;

    const destDir = this.getDestination(safe);
    const targetPath = path.join(destDir, filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    // "wx" fails instead of overwriting if the file already exists.
    await fs.promises.writeFile(targetPath, buffer, { flag: "wx" });

    const publicUrl = `/${safe}/${filename}`.replace(/\/+/g, "/");

    return {
      filename,
      url: publicUrl,
      path: targetPath,
      size: file.size,
      mimeType: file.type,
    };
  }

  /**
   * Multer disk storage for Express or custom server routes.
   * @param {string} [folder="uploads"]
   * @returns {*}
   */
  static storage(folder = "uploads", options = {}) {
    this._ensureMulter();
    const dest = this.getDestination(folder);
    const { allowDangerousExtensions = false } = options;

    return multer.diskStorage({
      destination: (req, file, cb) => cb(null, dest),
      filename: (req, file, cb) => {
        const mimeType = String(file.mimetype || "").toLowerCase();
        const mappedExt = MIME_EXTENSIONS[mimeType] || "";
        let ext = mappedExt || sanitizeExtension(path.extname(file.originalname || ""));
        if (!ext) ext = ".bin";
        if (!mappedExt && BLOCKED_EXTENSIONS.has(ext) && !allowDangerousExtensions) {
          return cb(new Error(`[UPLOAD ERROR] File extension '${ext}' is not allowed for security reasons.`));
        }
        cb(null, `${randomUUID()}${ext}`);
      },
    });
  }

  /**
   * Multer instance with file size and type filters.
   * @param {Object} [options={}]
   * @returns {*}
   */
  static disk(options = {}) {
    this._ensureMulter();
    const {
      folder = "uploads",
      maxSize,
      fileSize,
      allowedTypes = [],
      allowDangerousExtensions = false,
    } = options;
    const limit = fileSize ?? maxSize ?? 10485760;

    return multer({
      storage: this.storage(folder, { allowDangerousExtensions }),
      limits: { fileSize: limit },
      fileFilter: (req, file, cb) => {
        if (allowedTypes.length > 0 && !allowedTypes.includes(file.mimetype)) {
          return cb(new Error("File type not allowed"), false);
        }
        cb(null, true);
      },
    });
  }

  /**
   * Serves a previously uploaded file from a Route Handler.
   *
   * `next start` only serves files that existed in public/ at BUILD time, so files
   * uploaded at runtime return 404 unless nginx serves them. Add a catch-all route
   * with the same URL prefix as the folder:
   *
   *   // app/uploads/[...path]/route.js
   *   import { Upload } from "@seip/nextjs/upload";
   *   export async function GET(req, { params }) {
   *     return Upload.serve((await params).path, { folder: "uploads" });
   *   }
   *
   * @param {string|string[]} relativePath - Path segments after the folder.
   * @param {Object} [options={}]
   * @param {string} [options.folder="uploads"]
   * @param {string} [options.cacheControl="public, max-age=86400"]
   * @returns {Promise<Response>}
   */
  static async serve(relativePath, options = {}) {
    const { folder = "uploads", cacheControl = "public, max-age=86400" } = options;
    const notFound = () => new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });

    const segments = (Array.isArray(relativePath) ? relativePath : String(relativePath || "").split("/"))
      .map((segment) => String(segment))
      .filter((segment) => segment.length > 0);
    if (segments.length === 0) return notFound();
    for (const segment of segments) {
      if (segment === "." || segment === ".." || /[\\/\0]/.test(segment) || segment.startsWith(".")) {
        return notFound();
      }
    }

    let baseDir;
    try {
      const safe = safeFolder(folder);
      const isDesktop = Config.isDesktop();
      const root = isDesktop ? Config.userDataDir() : path.resolve(Config.appDir(), "public");
      const relativeDir = isDesktop
        ? (safe === "uploads" || safe.startsWith("uploads/") ? safe : `uploads/${safe}`)
        : safe;
      baseDir = resolveSafeDestination(root, relativeDir);
    } catch {
      return notFound();
    }

    let filePath;
    try {
      filePath = resolveSafeDestination(baseDir, segments.join("/"));
    } catch {
      return notFound();
    }

    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return notFound();
    }
    if (!stat.isFile()) return notFound();

    const ext = path.extname(filePath).toLowerCase();
    const mimeType = EXTENSION_MIME[ext] || "application/octet-stream";
    const headers = {
      "Content-Type": mimeType,
      "Content-Length": String(stat.size),
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": INLINE_TYPES.has(mimeType)
        ? "inline"
        : `attachment; filename="${path.basename(filePath).replace(/"/g, "")}"`,
    };

    const stream = Readable.toWeb(fs.createReadStream(filePath));
    return new Response(stream, { status: 200, headers });
  }

  static url(filename, folder = "uploads") {
    const name = String(filename || "");
    if (!name || /[\\/]/.test(name) || name.includes("..")) {
      throw new Error(`[UPLOAD ERROR] Invalid filename '${filename}'.`);
    }
    return `/${safeFolder(folder)}/${name}`.replace(/\/+/g, "/");
  }
}

export { Upload };
export default Upload;
