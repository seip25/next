import fs from "node:fs";
import path from "node:path";

/**
 * Loads .env files with the same precedence as Next.js, without overriding
 * variables already present in the environment:
 *   process.env > .env.$(NODE_ENV).local > .env.local > .env.$(NODE_ENV) > .env
 * (.env.local is skipped when NODE_ENV=test, like Next.js does).
 *
 * The CLI runs outside Next.js, so without this `migrate` would ignore DB_TYPE /
 * DATABASE_URL from .env and silently target the default SQLite file.
 *
 * @param {string} [cwd=process.cwd()]
 * @returns {string[]} Files that were loaded.
 */
export function loadEnvFiles(cwd = process.cwd()) {
  const mode = process.env.NODE_ENV || "development";
  const candidates = [`.env.${mode}.local`, mode === "test" ? null : ".env.local", `.env.${mode}`, ".env"].filter(
    Boolean
  );

  const loaded = [];
  for (const name of candidates) {
    const file = path.join(cwd, name);
    if (!fs.existsSync(file)) continue;
    try {
      // process.loadEnvFile never overrides existing keys, so earlier files win.
      process.loadEnvFile(file);
      loaded.push(name);
    } catch (err) {
      console.warn(`[ENV WARN] Could not load ${name}: ${err.message}`);
    }
  }
  return loaded;
}

export default loadEnvFiles;
