import { database } from "./database.js";

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/;

function assertIdent(name, what) {
  if (typeof name !== "string" || !IDENT.test(name)) {
    throw new Error(`[TABLE ERROR] Invalid ${what} identifier '${name}'.`);
  }
  return name;
}

/** Reads a value from URLSearchParams, a Next.js searchParams object or a plain object. */
function readParam(params, key) {
  if (!params) return undefined;
  if (typeof params.get === "function") return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function paramKeys(params) {
  if (!params) return [];
  if (typeof params.keys === "function") return [...params.keys()];
  return Object.keys(params);
}

/**
 * Server-side companion of the <DataTable mode="url"> component (and any paginated list):
 * parses ?q=&page=&limit=&sort=&dir=&f_<column>= safely and runs the query with
 * search (OR over columns), equality filters, ORDER BY and LIMIT/OFFSET.
 *
 * Every column name comes from YOUR whitelist (searchable / sortable / filterable),
 * never from the URL, and every value is a bound parameter: no SQL injection.
 */
class TableQuery {
  /**
   * @param {URLSearchParams|Record<string, string|string[]>} searchParams Awaited `searchParams` of a page.
   * @param {{sortable?: string[], filterable?: string[], defaultSort?: string, defaultDir?: "asc"|"desc",
   *   defaultLimit?: number, maxLimit?: number}} [config]
   * @returns {{page: number, limit: number, search: string, sort: string|null, dir: "asc"|"desc", filters: Record<string, string>}}
   */
  static parse(searchParams, config = {}) {
    const { sortable = [], filterable = [], defaultSort = null, defaultDir = "asc", defaultLimit = 10, maxLimit = 100 } = config;
    const page = Math.max(1, parseInt(readParam(searchParams, "page"), 10) || 1);
    const limit = Math.min(Math.max(1, parseInt(maxLimit, 10) || 100), Math.max(1, parseInt(readParam(searchParams, "limit"), 10) || defaultLimit));
    const search = String(readParam(searchParams, "q") ?? "").trim().slice(0, 200);

    const sortParam = readParam(searchParams, "sort");
    const sort = sortParam && sortable.includes(sortParam) ? sortParam : defaultSort;
    const dirParam = String(readParam(searchParams, "dir") ?? (sortParam ? "asc" : defaultDir)).toLowerCase();
    const dir = dirParam === "desc" ? "desc" : "asc";

    const filters = {};
    for (const key of paramKeys(searchParams)) {
      if (!key.startsWith("f_")) continue;
      const column = key.slice(2);
      const value = readParam(searchParams, key);
      if (filterable.includes(column) && value !== undefined && value !== "") filters[column] = String(value).slice(0, 200);
    }

    return { page, limit, search, sort, dir, filters };
  }

  /**
   * Builds the SQL (without LIMIT) and its parameters. Exposed for custom queries/tests.
   * @param {ReturnType<typeof TableQuery.parse>} query
   * @param {{table: string, select?: string, searchable?: string[], sortable?: string[], filterable?: string[],
   *   where?: {sql: string, params?: any[]}, dialect?: string, softDelete?: boolean}} options
   * @returns {{sql: string, params: any[]}}
   */
  static build(query = {}, options = {}) {
    const { table, select = "*", searchable = [], sortable, filterable, where, dialect = "sqlite", softDelete = false } = options;
    assertIdent(table, "table");

    const clauses = [];
    const params = [];

    if (softDelete) clauses.push("deleted_at IS NULL");
    if (where?.sql) {
      clauses.push(`(${where.sql})`);
      params.push(...(where.params || []));
    }

    const term = String(query.search ?? "").trim();
    if (term && searchable.length > 0) {
      const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const parts = searchable.map((col) => {
        assertIdent(col, "search column");
        params.push(like);
        if (dialect === "postgres") return `CAST(${col} AS TEXT) ILIKE ? ESCAPE '\\'`;
        if (dialect === "mysql") return `CAST(${col} AS CHAR) LIKE ? ESCAPE '\\\\'`;
        return `CAST(${col} AS TEXT) LIKE ? ESCAPE '\\'`;
      });
      clauses.push(`(${parts.join(" OR ")})`);
    }

    for (const [col, value] of Object.entries(query.filters || {})) {
      if (filterable && !filterable.includes(col)) continue;
      assertIdent(col, "filter column");
      clauses.push(`${col} = ?`);
      params.push(value);
    }

    let sql = `SELECT ${select} FROM ${table}`;
    if (clauses.length) sql += ` WHERE ${clauses.join(" AND ")}`;
    if (query.sort && (!sortable || sortable.includes(query.sort))) {
      assertIdent(query.sort, "sort column");
      sql += ` ORDER BY ${query.sort} ${query.dir === "desc" ? "DESC" : "ASC"}`;
    }
    return { sql, params };
  }

  /**
   * Runs a paginated query for a Model class or a table name.
   * @example
   * // app/users/page.js (Server Component)
   * const query = TableQuery.parse(await searchParams, { sortable: ["name", "created_at"], filterable: ["role"] });
   * const result = await TableQuery.paginate(User, query, { searchable: ["name", "email"] });
   * return <UsersTable data={result.data} total={result.total} query={query} />;
   *
   * @param {Function|string} source Model class (uses its table, DB, softDelete and hidden fields) or table name.
   * @param {ReturnType<typeof TableQuery.parse>} query
   * @param {{searchable?: string[], sortable?: string[], filterable?: string[], select?: string,
   *   where?: {sql: string, params?: any[]}, db?: any, maxLimit?: number}} [options]
   * @returns {Promise<{data: any[], total: number, page: number, limit: number, totalPages: number, query: object}>}
   */
  static async paginate(source, query = {}, options = {}) {
    const isModel = typeof source === "function" && typeof source.getDatabase === "function";
    const table = isModel ? source.table : source;
    const db = options.db || (isModel ? source.getDatabase() : database);

    const { sql, params } = this.build(query, {
      ...options,
      table,
      dialect: db.type,
      softDelete: isModel ? Boolean(source.softDelete) && !options.withDeleted : false,
    });

    const result = await db.paginate(sql, params, {
      page: query.page,
      limit: query.limit,
      ...(options.maxLimit !== undefined ? { maxLimit: options.maxLimit } : {}),
    });
    if (isModel && typeof source.filterHidden === "function") {
      result.data = result.data.map((row) => source.filterHidden(row, options.withHidden));
    }
    return { ...result, query };
  }
}

export { TableQuery };
export default TableQuery;
