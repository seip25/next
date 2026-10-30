import path from "node:path";
import os from "node:os";

let _cachedProps = null;
let _customUserDataDir = null;
let _customAppDir = null;

const ASAR_SEGMENT = /(?:^|[\\/])app\.asar(?:[\\/]|$)/;

/**
 * Detects a path inside a packaged Electron archive.
 * Avoids false positives from directories whose name merely contains ".asar".
 * @param {string} [value]
 * @returns {boolean}
 */
function isAsarPath(value) {
  return ASAR_SEGMENT.test(String(value || ""));
}

/**
 * Configuration class to manage Next.js environment settings,
 * directory paths, and Electron/Nextron desktop persistent storage.
 */
class Config {
  /**
   * Sets a custom base directory for application assets (e.g. Electron app.getAppPath()).
   * @param {string} dirPath
   */
  static setAppDir(dirPath) {
    _customAppDir = dirPath ? path.resolve(dirPath) : null;
    _cachedProps = null;
  }

  /**
   * Returns the base directory of the application.
   * In Electron or when appDir is customized, returns configured application directory.
   * Otherwise falls back to APP_DIR environment variable or process.cwd().
   * @returns {string}
   */
  static appDir() {
    if (_customAppDir) return _customAppDir;
    if (process.env.APP_DIR) return path.resolve(process.env.APP_DIR);
    return process.cwd();
  }

  /**
   * Alias for appDir().
   * @returns {string}
   */
  static dirname() {
    return this.appDir();
  }

  /**
   * Checks whether the application is running in Electron or Desktop mode.
   * @returns {boolean}
   */
  static isDesktop() {
    return Boolean(
      process.versions?.electron ||
      process.env.DESKTOP_MODE === "true" ||
      _customUserDataDir ||
      _customAppDir
    );
  }

  /**
   * Sets a custom writable directory for databases, logs, and uploads
   * (e.g. Electron app.getPath("userData")).
   * @param {string} dirPath
   */
  static setUserDataDir(dirPath) {
    _customUserDataDir = dirPath ? path.resolve(dirPath) : null;
    _cachedProps = null;
  }

  /**
   * Returns a writable base directory for persistent runtime files (SQLite DB, logs, uploads).
   * In standard server / VPS environments, returns process.cwd().
   * In Electron / Nextron Desktop mode, returns the OS writable user data directory
   * to avoid read-only (EROFS) errors when packaged in .asar.
   * @returns {string}
   */
  static userDataDir() {
    if (_customUserDataDir) return _customUserDataDir;
    if (process.env.USER_DATA_PATH) return path.resolve(process.env.USER_DATA_PATH);

    const cwd = process.cwd();
    const appDir = this.appDir();

    if (
      isAsarPath(cwd) ||
      isAsarPath(appDir) ||
      this.isDesktop()
    ) {
      const appName = (process.env.APP_NAME || process.env.TITLE || "seip-app")
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-");

      const baseAppData =
        process.env.APPDATA ||
        (process.platform === "darwin"
          ? path.join(os.homedir(), "Library", "Application Support")
          : path.join(os.homedir(), ".local", "share"));

      return path.join(baseAppData, appName);
    }

    return cwd;
  }

  /**
   * Retrieves application properties from environment variables.
   * Cached after the first call.
   * @returns {Object}
   */
  static props() {
    if (_cachedProps) return _cachedProps;

    const portRaw = parseInt(process.env.PORT, 10);

    _cachedProps = {
      debug: process.env.DEBUG === "true" || process.env.NODE_ENV !== "production",
      desktop: this.isDesktop(),
      userDataDir: this.userDataDir(),
      appDir: this.appDir(),
      title: process.env.APP_NAME || process.env.TITLE || "Next App",
      version: process.env.VERSION || "1.0.0",
      host: process.env.HOST || "0.0.0.0",
      appUrl: process.env.APP_URL || `http://localhost:${Number.isNaN(portRaw) ? 3000 : portRaw}`,
      port: Number.isNaN(portRaw) ? 3000 : portRaw,
      jwtSecret: process.env.JWT_SECRET,
      static: {
        path: process.env.STATIC_PATH || "public",
      },
    };
    return _cachedProps;
  }

  /**
   * Clears cached properties.
   */
  static reload() {
    _cachedProps = null;
  }
}

export { Config };
export default Config;
