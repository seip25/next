import fs from "node:fs";
import path from "node:path";
import Config from "./config.js";

const rawDbType = (process.env.DB_TYPE || "").toLowerCase().trim();
let DB_TYPE = "";

if (
  rawDbType === "sqlite" ||
  rawDbType === "sqlite3" ||
  rawDbType === "sql" ||
  rawDbType === "better-sqlite3" ||
  rawDbType === "better-sqlite" ||
  rawDbType === "lite"
) {
  DB_TYPE = "sqlite";
} else if (
  rawDbType === "postgres" ||
  rawDbType === "postgresql" ||
  rawDbType === "pg" ||
  rawDbType === "psql" ||
  rawDbType === "pgsql"
) {
  DB_TYPE = "postgres";
} else if (
  rawDbType === "mysql" ||
  rawDbType === "mariadb" ||
  rawDbType === "maria" ||
  rawDbType === "my"
) {
  DB_TYPE = "mysql";
} else if (
  rawDbType === "none" ||
  rawDbType === "no" ||
  rawDbType === "false" ||
  rawDbType === "null" ||
  rawDbType === "0"
) {
  DB_TYPE = "none";
}

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

let mysqlPromise = null;
let pgPromise = null;
let sqlitePromise = null;

if (DB_TYPE === "postgres") {
  try {
    pgPromise = await import("pg");
  } catch {
    console.error("[DATABASE ERROR] 'pg' package is not installed. Run 'npm install pg'.");
  }
} else if (DB_TYPE === "mysql") {
  try {
    mysqlPromise = await import("mysql2/promise");
  } catch {
    console.error("[DATABASE ERROR] 'mysql2' package is not installed. Run 'npm install mysql2'.");
  }
} else if (DB_TYPE === "sqlite") {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const testDb = new DatabaseSync(":memory:");
    testDb.close();
    sqlitePromise = { source: "node:sqlite", DatabaseSync };
  } catch {
    try {
      const mod = await import("better-sqlite3");
      sqlitePromise = { source: "better-sqlite3", BetterSqlite: mod.default || mod };
    } catch {
      console.error(
        "[DATABASE] No SQLite driver found. Node.js 22.18+ provides native 'node:sqlite', or install 'better-sqlite3'."
      );
    }
  }
}

/**
 * Replaces ? parameter placeholders with $1, $2, etc., ignoring quoted string literals.
 * @param {string} sql
 * @returns {string}
 */
function toPostgresSql(sql) {
  let paramIndex = 1;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let result = "";

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1];
    const prev = i > 0 ? sql[i - 1] : "";

    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote && nextChar === "'") {
        result += "''";
        i++;
        continue;
      }
      if (prev !== "\\") {
        inSingleQuote = !inSingleQuote;
      }
      result += char;
    } else if (char === '"' && !inSingleQuote) {
      if (inDoubleQuote && nextChar === '"') {
        result += '""';
        i++;
        continue;
      }
      if (prev !== "\\") {
        inDoubleQuote = !inDoubleQuote;
      }
      result += char;
    } else if (char === "?" && !inSingleQuote && !inDoubleQuote) {
      result += `$${paramIndex++}`;
    } else {
      result += char;
    }
  }

  return result;
}

const _activeDatabases = new Set();

/**
 * Database wrapper supporting SQLite (node:sqlite / better-sqlite3), Postgres, and MySQL.
 * Includes connection pooling, singleton for Next.js HMR, and Electron/Desktop path resolution.
 */
class Database {
  constructor(connectionLimit = 10, queueLimit = 0, config = {}) {
    this.pool = null;
    this.db = null;
    this.type = config.DB_TYPE || DB_TYPE;
    this._stmtCache = new Map();
    this._maxStatements = 500;

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

    this.sqliteConfig = {
      filename: config.DB_FILE || defaultSqliteFile,
      busyTimeout: config.busyTimeout || busyTimeout,
      journalMode: config.journalMode || journalMode,
      synchronous: config.synchronous || synchronous,
    };

    this.config = {
      ...config,
      host: process.env.DB_HOST || "localhost",
      user: process.env.DB_USER || (this.type === "postgres" ? "postgres" : "root"),
      password: process.env.DB_PASSWORD || "root",
      database: process.env.DB_NAME || "app",
      port: parseInt(process.env.DB_PORT, 10) || (this.type === "postgres" ? 5432 : 3306),
      charset: "utf8mb4",
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
          this.config.user = url.username;
          this.config.password = url.password;
          this.config.database = url.pathname.substring(1);
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
   * @param {number} [retries=3]
   * @returns {Promise<boolean>}
   */
  async init(retries = 3) {
    if (!mysqlPromise && !pgPromise && !sqlitePromise) return false;
    if (this.pool || this.db) return true;

    if (this.type === "sqlite" && sqlitePromise) {
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

        if (sqlitePromise.source === "node:sqlite") {
          const { DatabaseSync } = sqlitePromise;
          this.db = new DatabaseSync(dbFilePath);
          this._sqliteDriver = "node:sqlite";
          this.db.exec(`PRAGMA journal_mode = ${this.sqliteConfig.journalMode};`);
          this.db.exec(`PRAGMA synchronous = ${this.sqliteConfig.synchronous};`);
          this.db.exec(`PRAGMA busy_timeout = ${this.sqliteConfig.busyTimeout};`);
          this.db.exec("PRAGMA foreign_keys = ON;");
          this.db.exec("PRAGMA temp_store = MEMORY;");
          this.db.exec("PRAGMA cache_size = -8000;");
        } else {
          const { BetterSqlite } = sqlitePromise;
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
      try {
        if (this.type === "postgres" && pgPromise) {
          const pg = pgPromise.default || pgPromise;
          this.pool = new pg.Pool(this.config);
          await this.pool.query("SELECT 1");
        } else if (mysqlPromise) {
          const { max, connectionString, ...mysqlConfig } = this.config;
          this.pool = mysqlPromise.createPool(mysqlConfig);
          await this.pool.query("SELECT 1");
        }
        return true;
      } catch (err) {
        this.pool = null;
        if (attempt === retries) {
          console.error(`[DATABASE ERROR] Connection failed after ${retries} attempts:`, err.message);
          return false;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    return false;
  }

  /**
   * Runs a SQL query with parameters and formatting options.
   * @param {string} sql - SQL query string.
   * @param {Array} [params=[]] - Query parameters.
   * @param {Object|string} [options={}] - Query options.
   * @returns {Promise<*>}
   */
  async query(sql, params = [], options = {}) {
    if (!mysqlPromise && !pgPromise && !sqlitePromise) return false;
    if (!this.pool && !this.db) {
      const initialized = await this.init();
      if (!initialized) return false;
    }

    const queryOptions = typeof options === "string" ? { [options]: true } : options;
    const cleanSql = sql.trim();
    const isSelect = /^\s*(select|pragma|explain|with)\b/i.test(cleanSql);
    const hasReturning = /\breturning\b/i.test(cleanSql);
    const isInsert = /^\s*insert\b/i.test(cleanSql);

    try {
      if (this.type === "sqlite" && this.db) {
        const stmt = this._getPreparedStatement(cleanSql);

        if (isSelect || hasReturning) {
          if (queryOptions.return_row) {
            const row = stmt.get(...params);
            return row || null;
          }
          const rows = stmt.all(...params);
          return rows;
        }

        if (isInsert) {
          const info = stmt.run(...params);
          return Number(info.lastInsertRowid);
        }

        const info = stmt.run(...params);
        return info.changes;
      } else if (this.type === "postgres" && pgPromise) {
        const pgSql = toPostgresSql(cleanSql);
        const res = await this.pool.query(pgSql, params);

        if (isSelect || hasReturning) {
          const rows = res.rows || [];
          return queryOptions.return_row ? (rows.length > 0 ? rows[0] : null) : rows;
        }

        if (isInsert) {
          if (res.rows && res.rows.length > 0) {
            return res.rows[0].id || res.rows[0];
          }
          return res.rowCount;
        }

        return res.rowCount;
      } else {
        const [results] = await this.pool.execute(cleanSql, params);

        if (isSelect || hasReturning) {
          const rows = Array.isArray(results) ? results : [];
          return queryOptions.return_row ? (rows.length > 0 ? rows[0] : null) : rows;
        }

        if (isInsert) {
          return results.insertId || results;
        }

        return results;
      }
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
   * @param {Object} [options={}]
   * @returns {Promise<{data: Array, total: number, page: number, limit: number, totalPages: number}>}
   */
  async paginate(sql, params = [], options = {}) {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.max(1, parseInt(options.limit, 10) || 10);
    const offset = (page - 1) * limit;

    const cleanSql = sql.trim().replace(/;$/, "");
    const countSql = `SELECT COUNT(*) as total FROM (${cleanSql}) as _count_subquery`;

    const countResult = await this.query(countSql, params, { return_row: true });
    const total = Number(countResult?.total || countResult?.count || 0);
    const totalPages = Math.ceil(total / limit);

    const paginatedSql = `${cleanSql} LIMIT ${limit} OFFSET ${offset}`;
    const rows = await this.query(paginatedSql, params, options);

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
   * @param {Function} callback - async (tx) => { ... }
   * @returns {Promise<*>}
   */
  async transaction(callback) {
    if (!mysqlPromise && !pgPromise && !sqlitePromise) throw new Error("[DATABASE ERROR] No database driver available.");
    if (!this.pool && !this.db) {
      const initialized = await this.init();
      if (!initialized) throw new Error("[DATABASE ERROR] Failed to initialize database.");
    }

    if (this.type === "sqlite" && this.db) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const tx = {
          query: async (sql, params = [], options = {}) => {
            const queryOptions = typeof options === "string" ? { [options]: true } : options;
            const cleanSql = sql.trim();
            const isSelect = /^\s*(select|pragma|explain|with)\b/i.test(cleanSql);
            const hasReturning = /\breturning\b/i.test(cleanSql);
            const isInsert = /^\s*insert\b/i.test(cleanSql);

            const stmt = this._getPreparedStatement(cleanSql);
            if (isSelect || hasReturning) {
              if (queryOptions.return_row) {
                const row = stmt.get(...params);
                return row || null;
              }
              return stmt.all(...params);
            }
            if (isInsert) {
              const info = stmt.run(...params);
              return Number(info.lastInsertRowid);
            }
            const info = stmt.run(...params);
            return info.changes;
          },
        };

        const result = await callback(tx);
        this.db.exec("COMMIT");
        return result;
      } catch (err) {
        this.db.exec("ROLLBACK");
        console.error("[DATABASE ERROR] Transaction rolled back:", err.message);
        throw err;
      }
    } else if (this.type === "postgres" && pgPromise) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const tx = {
          query: async (sql, params = [], options = {}) => {
            const queryOptions = typeof options === "string" ? { [options]: true } : options;
            const cleanSql = sql.trim();
            const isSelect = /^\s*(select|pragma|explain|with)\b/i.test(cleanSql);
            const hasReturning = /\breturning\b/i.test(cleanSql);
            const isInsert = /^\s*insert\b/i.test(cleanSql);

            const pgSql = toPostgresSql(cleanSql);
            const res = await client.query(pgSql, params);

            if (isSelect || hasReturning) {
              const rows = res.rows || [];
              return queryOptions.return_row ? (rows[0] || null) : rows;
            }
            if (isInsert) {
              if (res.rows && res.rows.length > 0) return res.rows[0].id || res.rows[0];
              return res.rowCount;
            }
            return res.rowCount;
          },
        };

        const result = await callback(tx);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        console.error("[DATABASE ERROR] Transaction rolled back:", err.message);
        throw err;
      } finally {
        client.release();
      }
    } else {
      const connection = await this.pool.getConnection();
      try {
        await connection.beginTransaction();
        const tx = {
          query: async (sql, params = [], options = {}) => {
            const queryOptions = typeof options === "string" ? { [options]: true } : options;
            const cleanSql = sql.trim();
            const isSelect = /^\s*(select|pragma|explain|with)\b/i.test(cleanSql);
            const hasReturning = /\breturning\b/i.test(cleanSql);
            const isInsert = /^\s*insert\b/i.test(cleanSql);

            const [results] = await connection.execute(cleanSql, params);
            if (isSelect || hasReturning) {
              const rows = Array.isArray(results) ? results : [];
              return queryOptions.return_row ? (rows[0] || null) : rows;
            }
            if (isInsert) {
              return results.insertId || results;
            }
            return results;
          },
        };

        const result = await callback(tx);
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
  }

  /**
   * Closes the database connection pool or SQLite instance, checkpointing WAL if SQLite.
   */
  async close() {
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
      if (typeof this.pool.end === "function") {
        await this.pool.end();
      }
      this.pool = null;
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

export { Database, database, db, DB_TYPE };
export default database;
