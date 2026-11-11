/**
 * Loads an OPTIONAL npm dependency (bcrypt, pg, mysql2, better-sqlite3, multer, ws) at runtime.
 *
 * Bundlers (Turbopack / webpack) statically analyze `import("bcrypt")` and fail the build with
 * "Module not found" when the package is not installed, even inside try/catch. The magic comments
 * plus a non-literal specifier make both bundlers leave the import to Node.js at runtime, so:
 *  - the app builds without `serverExternalPackages: ["@seip/nextjs"]`;
 *  - the package is still loaded from node_modules when it IS installed.
 *
 * Never use this for `next/*` modules: those must be bundled to share the request context.
 *
 * @param {string} name Module specifier, e.g. "bcrypt" or "mysql2/promise".
 * @returns {Promise<any|null>} The module namespace, or null when it is not installed.
 */
const cache = (globalThis.__seip_next_optional_modules ??= new Map());

export function importOptional(name) {
  if (!cache.has(name)) {
    const specifier = String(name);
    cache.set(
      name,
      import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ specifier).catch(
        () => null
      )
    );
  }
  return cache.get(name);
}

/**
 * Registers an already-imported optional module. Useful with `output: "standalone"`:
 * a static `import pg from "pg"` in your app lets Next.js trace and copy it into
 * .next/standalone, and registering it makes @seip/nextjs reuse that instance.
 * @example
 * import pg from "pg";
 * import { registerModule } from "@seip/nextjs";
 * registerModule("pg", pg);
 * @param {string} name
 * @param {any} mod
 */
export function registerModule(name, mod) {
  if (!name || !mod) throw new Error("[SEIP] registerModule(name, module) requires both arguments.");
  cache.set(String(name), Promise.resolve(mod));
}

/** Returns the default export (CJS interop) or the namespace itself. */
export async function importOptionalDefault(name) {
  const mod = await importOptional(name);
  return mod ? mod.default || mod : null;
}

export default importOptional;
