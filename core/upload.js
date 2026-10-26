import path from "node:path";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import Config from "./config.js";

let multer = null;
try {
  multer = (await import("multer")).default || (await import("multer"));
} catch {}

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
    const isDesktop = Config.isDesktop();
    const dest = isDesktop
      ? (folder.startsWith("uploads")
          ? path.join(Config.userDataDir(), folder)
          : path.join(Config.userDataDir(), "uploads", folder))
      : path.resolve(Config.appDir(), "public", folder);

    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    return dest;
  }

  /**
   * Saves a File/Blob uploaded via Next.js FormData in Server Actions or Route Handlers.
   * Zero-dependency native stream saving.
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
    const ext = path.extname(originalName) || ".bin";
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const filename = `${uniqueSuffix}${ext}`;

    const destDir = this.getDestination(folder);
    const targetPath = path.join(destDir, filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.promises.writeFile(targetPath, buffer);

    const publicUrl = `/${folder}/${filename}`.replace(/\/+/g, "/");

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
  static storage(folder = "uploads") {
    this._ensureMulter();
    const dest = this.getDestination(folder);

    return multer.diskStorage({
      destination: (req, file, cb) => cb(null, dest),
      filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
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
    const { folder = "uploads", fileSize = 10485760, allowedTypes = [] } = options;

    return multer({
      storage: this.storage(folder),
      limits: { fileSize },
      fileFilter: (req, file, cb) => {
        if (allowedTypes.length > 0 && !allowedTypes.includes(file.mimetype)) {
          return cb(new Error("File type not allowed"), false);
        }
        cb(null, true);
      },
    });
  }

  static url(filename, folder = "uploads") {
    return `/${folder}/${filename}`.replace(/\/+/g, "/");
  }
}

export { Upload };
export default Upload;
