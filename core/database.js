import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import Config from "./config.js";

/**
 * Normalizes any supported DB_TYPE alias ("pg", "mariadb", "better-sqlite"…)
 * to one of: "sqlite", "postgres", "mysql", "none" or "" (unknown).
 * @param {string} [value]
 * @returns {string}
 */
function normalizeDbType(value) {
  const raw = String(value ?? "").toLowerCase().trim();
  if (!raw) return "";
  if (["sqlite", "sqlite3", "sql", "better-sqlite3", "better-sqlite", "lite"].includes(raw)) {
    return "sqlite";
  }
  if (["postgres", "postgresql", "pg", "psql", "pgsql"].includes(raw)) {
    return "postgres";
  }
  if (["mysql", "mariadb", "maria", "my"].includes(raw)) {
    return "mysql";
  }
  if (["none", "no", "false", "null", "0"].includes(raw)) {
    return "none";
  }
  return "";
}

let DB_TYPE = normalizeDbType(process.env.DB_TYPE);

if (!DB_TYPE && process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith("#")) {
  if (
    process.env.DATABASE_URL.startsWith("postgres://") ||
    process.env.DATABASE_URL.startsWith("postgresql://")
  ) {
    DB_TYPE = "postgres";
  } else if (process.env.DATABASE_URL.startsWith("mysql://")) {
    DB_TYPE = "mysql";
  } else if (
    process.env.DATABASE_URL.startsWith("sqlite://") ||
    process.env.DATABASE_URL.startsWith("sqlite:")
  ) {
    DB_TYPE = "sqlite";
  }
}
if (!DB_TYPE) {
  DB_TYPE = "sqlite";
}

/**
 * Tracks the active transaction per async context. The store records which
 * Database owns it (and the dedicated client for Postgres/MySQL), so queries
 * issued inside a transaction callback run on the transaction's connection.
 */
const txContext = new AsyncLocalStorage();

/**
 * Drivers are loaded lazily (on first init) and memoized process-wide, so importing
 * this module (e.g. from proxy.js) does not load pg/mysql2/sqlite until needed.
 */
const driverCache = (globalThis.__seip_next_db_drivers ??= new Map());

async function loadSqliteDriver() {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const testDb = new DatabaseSync(":memory:");
    testDb.close();
    return { source: "node:sqlite", DatabaseSync };
  } catch {
    try {
      const mod = await import("better-sqlite3");
      return { source: "better-sqlite3", BetterSqlite: mod.default || mod };
    } catch {
      console.error(
        "[DATABASE] No SQLite driver found. Node.js 22.18+ provides native 'node:sqlite', or install 'better-sqlite3'."
      );
      return null;
    }
  }
}

async function loadDriverModule(type) {
  if (type === "postgres") {
    try {
      const mod = await import("pg");
      return mod.default || mod;
    } catch {
      console.error("[DATABASE ERROR] 'pg' package is not installed. Run 'npm install pg'.");
      return null;
    }
  }
  if (type === "mysql") {
    try {
      return await import("mysql2/promise");
    } catch {
      console.error("[DATABASE ERROR] 'mysql2' package is not installed. Run 'npm install mysql2'.");
      return null;
    }
  }
  if (type === "sqlite") return loadSqliteDriver();
  return null;
}

/**
 * @param {string} type
 * @returns {Promise<any|null>}
 */
function loadDriver(type) {
  if (!driverCache.has(type)) driverCache.set(type, loadDriverModule(type));
  return driverCache.get(type);
}

/**
 * Normalizes a bound parameter for the target dialect.
 *  - undefined -> null (drivers reject undefined)
 *  - SQLite: booleans -> 1/0, Date -> ISO-8601, objects/arrays -> JSON
 *  - MySQL: booleans -> 1/0, objects/arrays -> JSON (Date is handled by mysql2)
 *  - Postgres: left as-is (pg serializes Date, arrays and JSON objects itself)
 * @param {any} value
 * @param {string} type
 * @returns {any}
 */
function normalizeParam(value, type) {
  if (value === undefined) return null;
  if (value === null || type === "postgres") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return type === "sqlite" ? value.toISOString() : value;
  if (typeof value === "object" && !Buffer.isBuffer(value) && !ArrayBuffer.isView(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function normalizeParams(params, type) {
  if (!Array.isArray(params)) return [];
  return params.map((value) => normalizeParam(value, type));
}

/**
 * Classifies a statement to decide how its result is returned.
 * @param {string} sql
 */
function classifySql(sql) {
  return {
    isSelect: /^\s*\(?\s*(select|pragma|explain|with|show|describe|desc|values)\b/i.test(sql),
    hasReturning: hasReturningClause(sql),
    isInsert: /^\s*insert\b/i.test(sql),
  };
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Replaces ? parameter placeholders with $1, $2, etc., ignoring:
 *  - single/double quoted literals and identifiers,
 *  - line (--) and block comments,
 *  - dollar-quoted strings ($$...$$, $tag$...$tag$).
 * Use `\?` for a literal Postgres JSON operator `?` (e.g. WHERE data \? 'key').
 * @param {string} sql
 * @returns {string}
 */
function toPostgresSql(sql) {
  let paramIndex = 1;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag = null;
  let result = "";

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1];

    if (inLineComment) {
      result += char;
      if (char === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      result += char;
      if (char === "*" && nextChar === "/") {
        result += nextChar;
        i++;
        inBlockComment = false;
      }
      continue;
    }

    if (dollarTag) {
      if (char === "$" && sql.startsWith(dollarTag, i)) {
        result += dollarTag;
        i += dollarTag.length - 1;
        dollarTag = null;
        continue;
      }
      result += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === "-" && nextChar === "-") {
      result += "--";
      i++;
      inLineComment = true;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === "/" && nextChar === "*") {
      result += "/*";
      i++;
      inBlockComment = true;
      continue;
    }

    // Escaped literal operator: \? -> ? (not a placeholder).
    if (char === "\\" && nextChar === "?") {
      result += "?";
      i++;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote && nextChar === "'") {
        result += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      result += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      if (inDoubleQuote && nextChar === '"') {
        result += '""';
        i++;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      result += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === "$") {
      const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (match) {
        dollarTag = match[0];
        result += dollarTag;
        i += dollarTag.length - 1;
        continue;
      }
    }

    if (char === "?" && !inSingleQuote && !inDoubleQuote) {
      result += `$${paramIndex++}`;
      continue;
    }

    result += char;
  }

  return result;
}

/**
 * Detects a real RETURNING clause, ignoring the word inside string literals,
 * quoted identifiers and SQL comments. A naive substring test makes an
 * INSERT like "VALUES ('returning home')" take the SELECT branch and return
 * the wrong result ([] instead of lastInsertRowid).
 * @param {string} sql
 * @returns {boolean}
 */
function hasReturningClause(sql) {
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (!inSingle && !inDouble && char === "-" && next === "-") {
      inLineComment = true;
      i++;
      continue;
    }
    if (!inSingle && !inDouble && char === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (char === "'" && !inDouble) {
      if (inSingle && next === "'") {
        i++;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }
    if (char === '"' && !inSingle) {
      if (inDouble && next === '"') {
        i++;
        continue;
      }
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && (char === "R" || char === "r")) {
      const isBoundaryBefore = !/[A-Za-z0-9_]/.test(sql[i - 1] || "");
      const isBoundaryAfter = !/[A-Za-z0-9_]/.test(sql[i + 9] || "");
      if (isBoundaryBefore && isBoundaryAfter && sql.slice(i, i + 9).toUpperCase() === "RETURNING") {
        return true;
      }
    }
  }
  return false;
}

const _activeDatabases = (globalThis.__seip_next_active_dbs ??= new Set());

/**
 * Database wrapper supporting SQLite (node:sqlite / better-sqlite3), Postgres, and MySQL.
 * Includes connection pooling, singleton for Next.js HMR, and Electron/Desktop path resolution.
 */
class Database {
  constructor(connectionLimit = 10, queueLimit = 0, config = {}) {
    this.pool = null;
    this.db = null;
    this.type = normalizeDbType(config.DB_TYPE) || DB_TYPE;
    this._stmtCache = new Map();
    this._maxStatements = 500;
    this._txQueue = Promise.resolve();
    this._sqliteTxActive = false;
    this._savepointCounter = 0;
    this._initPromise = null;
    this._driver = null;

    let defaultSqliteFile = process.env.DB_FILE || "database/app.db";
    let busyTimeout = 5000;
    let journalMode = "WAL";
    let synchronous = "NORMAL";

    if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith("#")) {
      try {
        if (
          process.env.DATABASE_URL.startsWith("sqlite://") ||
          process.env.DATABASE_URL.startsWith("sqlite:")
        ) {
          const rawUrl = process.env.DATABASE_URL;
          const cleanUrl = rawUrl.replace(/^sqlite:\/\/|^sqlite:/, "");
          const [filePath, queryStr] = cleanUrl.split("?");
          if (filePath) {
            defaultSqliteFile = filePath;
          }
          if (queryStr) {
            const params = new URLSearchParams(queryStr);
            if (params.has("busy_timeout")) {
              busyTimeout = parseInt(params.get("busy_timeout"), 10) || busyTimeout;
            }
            if (params.has("journal_mode")) {
              journalMode = params.get("journal_mode").toUpperCase();
            }
            if (params.has("synchronous")) {
              synchronous = params.get("synchronous").toUpperCase();
            }
          }
        }
      } catch (err) {
        console.error("[DATABASE ERROR] Failed to parse SQLite DATABASE_URL:", err.message);
      }
    }

    // PRAGMA values are interpolated: only accept identifiers / numbers.
    const pragmaWord = (value, fallback) => (/^[A-Z]+$/.test(String(value)) ? String(value) : fallback);

    this.sqliteConfig = {
      filename: config.DB_FILE || defaultSqliteFile,
      busyTimeout: parseInt(config.busyTimeout || busyTimeout, 10) || 5000,
      journalMode: pragmaWord(String(config.journalMode || journalMode).toUpperCase(), "WAL"),
      synchronous: pragmaWord(String(config.synchronous || synchronous).toUpperCase(), "NORMAL"),
    };

    this.config = {
      ...config,
      // Explicit constructor config wins over environment variables.
      host: config.host ?? process.env.DB_HOST ?? "localhost",
      user: config.user ?? process.env.DB_USER ?? (this.type === "postgres" ? "postgres" : "root"),
      password: config.password ?? process.env.DB_PASSWORD ?? "root",
      database: config.database ?? process.env.DB_NAME ?? "app",
      port: config.port ?? (parseInt(process.env.DB_PORT, 10) || (this.type === "postgres" ? 5432 : 3306)),
      charset: config.charset ?? "utf8mb4",
      waitForConnections: true,
      connectionLimit: connectionLimit,
      queueLimit: queueLimit,
      max: connectionLimit,
    };

    if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith("#")) {
      try {
        if (
          process.env.DATABASE_URL.startsWith("mysql://") ||
          process.env.DATABASE_URL.startsWith("postgres://") ||
          process.env.DATABASE_URL.startsWith("postgresql://")
        ) {
          const url = new URL(process.env.DATABASE_URL);
          this.config.host = url.hostname;
          this.config.port = parseInt(url.port, 10) || (this.type === "postgres" ? 5432 : 3306);
          // URL keeps credentials percent-encoded ("p%40ss"); drivers need the raw value.
          this.config.user = safeDecode(url.username);
          this.config.password = safeDecode(url.password);
          this.config.database = safeDecode(url.pathname.substring(1));
          this.config.connectionString = process.env.DATABASE_URL;
        }
      } catch (err) {
        console.error("[DATABASE ERROR] Failed to parse DATABASE_URL:", err.message);
      }
    }

    _activeDatabases.add(this);
  }

  _getPreparedStatement(sql) {
    let stmt = this._stmtCache.get(sql);
    if (stmt) return stmt;

    stmt = this.db.prepare(sql);
    if (this._stmtCache.size >= this._maxStatements) {
      const oldestKey = this._stmtCache.keys().next().value;
      if (oldestKey !== undefined) this._stmtCache.delete(oldestKey);
    }
    this._stmtCache.set(sql, stmt);
    return stmt;
  }

  /**
   * Initializes connection pool or SQLite database.
   * Concurrent callers share the same in-flight initialization (no duplicated pools).
   * @param {number} [retries=3]
   * @returns {Promise<boolean>}
   */
  async init(retries = 3) {
    if (this.pool || this.db) return true;
    if (!this._initPromise) {
      this._initPromise = this._doInit(retries).finally(() => {
        this._initPromise = null;
      });
    }
    return this._initPromise;
  }

  async _doInit(retries) {
    const driver = await loadDriver(this.type);
    if (!driver) {
      console.error(`[DATABASE ERROR] No driver available for database type '${this.type}'.`);
      return false;
    }
    this._driver = driver;
    _activeDatabases.add(this);

    if (this.type === "sqlite") {
      try {
        const isMemoryDb = this.sqliteConfig.filename === ":memory:";
        const isDesktop = Config.isDesktop();
        const baseDir = isDesktop ? Config.userDataDir() : Config.appDir();

        const dbFilePath = isMemoryDb
          ? ":memory:"
          : path.isAbsolute(this.sqliteConfig.filename)
            ? this.sqliteConfig.filename
            : path.resolve(baseDir, this.sqliteConfig.filename);

        if (!isMemoryDb) {
          const dir = path.dirname(dbFilePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          // If SQLite file does not exist in userData (first launch in Electron), copy initial DB template
          if (!fs.existsSync(dbFilePath)) {
            const candidatePaths = [
              path.resolve(Config.appDir(), this.sqliteConfig.filename),
              process.resourcesPath ? path.join(process.resourcesPath, this.sqliteConfig.filename) : null,
              process.resourcesPath ? path.join(process.resourcesPath, "database", path.basename(this.sqliteConfig.filename)) : null,
              Config.appDir().includes(".asar")
                ? path.resolve(Config.appDir().replace(/\.asar(?=[\/\\]|$)/, ".asar.unpacked"), this.sqliteConfig.filename)
                : null,
              path.resolve(process.cwd(), this.sqliteConfig.filename),
            ].filter(Boolean);

            for (const candidate of candidatePaths) {
              if (fs.existsSync(candidate) && path.resolve(candidate) !== path.resolve(dbFilePath)) {
                try {
                  fs.copyFileSync(candidate, dbFilePath);
                  break;
                } catch {}
              }
            }
          }
        }

        if (driver.source === "node:sqlite") {
          const { DatabaseSync } = driver;
          this.db = new DatabaseSync(dbFilePath);
          this._sqliteDriver = "node:sqlite";
          this.db.exec(`PRAGMA journal_mode = ${this.sqliteConfig.journalMode};`);
          this.db.exec(`PRAGMA synchronous = ${this.sqliteConfig.synchronous};`);
          this.db.exec(`PRAGMA busy_timeout = ${this.sqliteConfig.busyTimeout};`);
          this.db.exec("PRAGMA foreign_keys = ON;");
          this.db.exec("PRAGMA temp_store = MEMORY;");
          this.db.exec("PRAGMA cache_size = -8000;");
        } else {
          const { BetterSqlite } = driver;
          this.db = new BetterSqlite(dbFilePath, { timeout: this.sqliteConfig.busyTimeout });
          this._sqliteDriver = "better-sqlite3";
          this.db.pragma(`journal_mode = ${this.sqliteConfig.journalMode}`);
          this.db.pragma(`synchronous = ${this.sqliteConfig.synchronous}`);
          this.db.pragma("foreign_keys = ON");
          this.db.pragma(`busy_timeout = ${this.sqliteConfig.busyTimeout}`);
          this.db.pragma("temp_store = MEMORY");
          this.db.pragma("cache_size = -8000");
        }

        return true;
      } catch (err) {
        console.error("[DATABASE] Failed to initialize SQLite database:", err.message);
        this.db = null;
        return false;
      }
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      let pool = null;
      try {
        if (this.type === "postgres") {
          pool = new driver.Pool(this.config);
          // Without a listener, an idle-client error (DB restart, network cut)
          // is an unhandled 'error' event and crashes the whole Next.js process.
          pool.on("error", (err) => {
            console.error("[DATABASE ERROR] Idle Postgres client error:", err.message);
          });
        } else {
          const { max, connectionString, ...mysqlConfig } = this.config;
          // Store/read DATETIME values as UTC unless told otherwise.
          if (mysqlConfig.timezone === undefined) mysqlConfig.timezone = "Z";
          pool = driver.createPool(mysqlConfig);
          pool.pool?.on?.("error", (err) => {
            console.error("[DATABASE ERROR] MySQL pool error:", err.message);
          });
        }
        await pool.query("SELECT 1");
        this.pool = pool;
        return true;
      } catch (err) {
        if (pool && typeof pool.end === "function") {
          await pool.end().catch(() => {});
        }
        if (attempt === retries) {
          console.error(`[DATABASE ERROR] Connection failed after ${retries} attempts:`, err.message);
          return false;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    return false;
  }

  async _ensureReady() {
    if (this.pool || this.db) return true;
    return this.init();
  }

  /** @returns {object|null} The transaction store when the caller runs inside one of THIS database's transactions. */
  _ownTxStore() {
    const store = txContext.getStore();
    return store && store.db === this ? store : null;
  }

  /**
   * SQLite has a single connection: while a transaction is open, statements from
   * other requests would silently join it (and be rolled back with it). They wait here.
   */
  async _waitSqliteIdle() {
    while (this._sqliteTxActive) {
      await this._txQueue;
    }
  }

  _sqliteExec(cleanSql, params, queryOptions, kind) {
    const stmt = this._getPreparedStatement(cleanSql);
    if (kind.isSelect || kind.hasReturning) {
      if (queryOptions.return_row) {
        const row = stmt.get(...params);
        return row || null;
      }
      return stmt.all(...params);
    }
    const info = stmt.run(...params);
    if (kind.isInsert) return Number(info.lastInsertRowid);
    return info.changes;
  }

  async _pgExec(client, cleanSql, params, queryOptions, kind) {
    const res = await client.query(toPostgresSql(cleanSql), params);
    if (kind.isSelect || kind.hasReturning) {
      const rows = res.rows || [];
      return queryOptions.return_row ? (rows[0] || null) : rows;
    }
    if (kind.isInsert && res.rows && res.rows.length > 0) {
      return res.rows[0].id ?? res.rows[0];
    }
    return res.rowCount;
  }

  async _mysqlExec(client, cleanSql, params, queryOptions, kind) {
    const [results] = await client.execute(cleanSql, params);
    if (kind.isSelect || kind.hasReturning) {
      const rows = Array.isArray(results) ? results : [];
      return queryOptions.return_row ? (rows[0] || null) : rows;
    }
    if (kind.isInsert && results && results.insertId !== undefined && results.insertId !== null) {
      return results.insertId;
    }
    return results;
  }

  /**
   * Runs a SQL query with parameters and formatting options.
   * Inside a `transaction()` callback it automatically runs on the transaction's connection.
   * @param {string} sql - SQL query string.
   * @param {Array} [params=[]] - Query parameters.
   * @param {Object|string} [options={}] - Query options.
   * @returns {Promise<*>}
   */
  async query(sql, params = [], options = {}) {
    return this._query(sql, params, options, this._ownTxStore());
  }

  async _query(sql, params, options, store) {
    if (!(await this._ensureReady())) return false;

    const queryOptions = typeof options === "string" ? { [options]: true } : options || {};
    const cleanSql = String(sql).trim();
    const kind = classifySql(cleanSql);
    const bound = normalizeParams(params, this.type);

    try {
      if (this.type === "sqlite" && this.db) {
        if (!store && this._sqliteTxActive) await this._waitSqliteIdle();
        return this._sqliteExec(cleanSql, bound, queryOptions, kind);
      }
      if (this.type === "postgres" && this.pool) {
        return await this._pgExec(store?.client || this.pool, cleanSql, bound, queryOptions, kind);
      }
      if (this.type === "mysql" && this.pool) {
        return await this._mysqlExec(store?.client || this.pool, cleanSql, bound, queryOptions, kind);
      }
      throw new Error(`[DATABASE ERROR] No connection available for database type '${this.type}'.`);
    } catch (err) {
      if (!queryOptions.silent) {
        console.error("[DATABASE ERROR] Query execution failed:", err.message);
      }
      throw err;
    }
  }

  /**
   * Executes a paginated SQL query.
   * @param {string} sql
   * @param {Array} [params=[]]
   * @param {Object} [options={}] - { page, limit, maxLimit = 100 }
   * @returns {Promise<{data: Array, total: number, page: number, limit: number, totalPages: number}>}
   */
  async paginate(sql, params = [], options = {}) {
    const maxLimit = Math.max(1, parseInt(options.maxLimit, 10) || 100);
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.min(maxLimit, Math.max(1, parseInt(options.limit, 10) || 10));
    const offset = (page - 1) * limit;

    const cleanSql = sql.trim().replace(/;$/, "");
    const countSql = `SELECT COUNT(*) as total FROM (${cleanSql}) as _count_subquery`;

    const countResult = await this.query(countSql, params, { return_row: true });
    const total = Number(countResult?.total || countResult?.count || 0);
    const totalPages = Math.ceil(total / limit);

    const paginatedSql = `${cleanSql} LIMIT ${limit} OFFSET ${offset}`;
    const { page: _p, limit: _l, maxLimit: _m, ...queryOptions } = options;
    const rows = await this.query(paginatedSql, params, queryOptions);

    return {
      data: Array.isArray(rows) ? rows : [],
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Executes a database transaction with automatic commit and rollback.
   * Nested calls (inside the callback) become SAVEPOINTs on the same connection.
   * Inside the callback, both `tx.query()` and `db.query()` run on the transaction.
   * @param {Function} callback - async (tx) => { ... }
   * @returns {Promise<*>}
   */
  async transaction(callback) {
    if (!(await this._ensureReady())) {
      throw new Error("[DATABASE ERROR] Failed to initialize database.");
    }

    const current = this._ownTxStore();
    if (current) return this._nestedTransaction(current, callback);

    if (this.type === "sqlite" && this.db) {
      const run = () => this._sqliteRootTransaction(callback);
      const queued = this._txQueue.then(run, run);
      this._txQueue = queued.then(
        () => undefined,
        () => undefined
      );
      return queued;
    }

    if (this.type === "postgres" && this.pool) {
      const client = await this.pool.connect();
      const store = { db: this, client };
      try {
        await client.query("BEGIN");
        const result = await txContext.run(store, () => callback(this._txHandle(store)));
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        console.error("[DATABASE ERROR] Transaction rolled back:", err.message);
        throw err;
      } finally {
        client.release();
      }
    }

    if (this.type === "mysql" && this.pool) {
      const connection = await this.pool.getConnection();
      const store = { db: this, client: connection };
      try {
        await connection.beginTransaction();
        const result = await txContext.run(store, () => callback(this._txHandle(store)));
        await connection.commit();
        return result;
      } catch (err) {
        await connection.rollback().catch(() => {});
        console.error("[DATABASE ERROR] Transaction rolled back:", err.message);
        throw err;
      } finally {
        connection.release();
      }
    }

    throw new Error(`[DATABASE ERROR] No connection available for database type '${this.type}'.`);
  }

  /** Query handle bound to a transaction store. */
  _txHandle(store) {
    return {
      query: (sql, params = [], options = {}) => this._query(sql, params, options, store),
    };
  }

  /**
   * Runs a statement that does not go through the prepared-statement path
   * (BEGIN / SAVEPOINT / RELEASE ...) on the transaction's connection.
   */
  async _txControl(store, sql) {
    if (this.type === "sqlite") return this.db.exec(sql);
    return store.client.query(sql);
  }

  async _sqliteRootTransaction(callback) {
    const store = { db: this, client: null };
    this.db.exec("BEGIN IMMEDIATE");
    this._sqliteTxActive = true;
    try {
      const result = await txContext.run(store, () => callback(this._txHandle(store)));
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      console.error("[DATABASE ERROR] Transaction rolled back:", err.message);
      throw err;
    } finally {
      this._sqliteTxActive = false;
    }
  }

  async _nestedTransaction(store, callback) {
    const savepoint = `seip_sp_${++this._savepointCounter}`;
    await this._txControl(store, `SAVEPOINT ${savepoint}`);
    try {
      const result = await callback(this._txHandle(store));
      await this._txControl(store, `RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (err) {
      try {
        await this._txControl(store, `ROLLBACK TO SAVEPOINT ${savepoint}`);
        await this._txControl(store, `RELEASE SAVEPOINT ${savepoint}`);
      } catch {}
      throw err;
    }
  }

  /**
   * Closes the database connection pool or SQLite instance, checkpointing WAL if SQLite.
   */
  async close() {
    if (this._initPromise) await this._initPromise.catch(() => {});
    this._stmtCache.clear();
    if (this.db) {
      try {
        if (this._sqliteDriver === "node:sqlite") {
          this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
        } else if (this._sqliteDriver === "better-sqlite3") {
          this.db.pragma("wal_checkpoint(TRUNCATE)");
        }
      } catch {}
      this.db.close();
      this.db = null;
    }
    if (this.pool) {
      const pool = this.pool;
      this.pool = null;
      if (typeof pool.end === "function") {
        await pool.end();
      }
    }
    _activeDatabases.delete(this);
  }

  static async closeAll() {
    const list = Array.from(_activeDatabases);
    for (const db of list) {
      try {
        await db.close();
      } catch (err) {
        console.error("[DATABASE] Error closing database connection:", err.message);
      }
    }
  }
}

// Next.js HMR Singleton: prevents multiple pools/connections across fast refreshes
if (!globalThis.__seip_next_db_instance) {
  globalThis.__seip_next_db_instance = new Database();
}

/**
 * Shared singleton Database instance.
 * @type {Database}
 */
const database = globalThis.__seip_next_db_instance;
const db = database;

export { Database, database, db, DB_TYPE, toPostgresSql, normalizeParam };
export default database;
