import { database } from "./database.js";
import Hash from "./hash.js";
import Validator from "./validate.js";

/**
 * Attempts Next.js cache revalidation if running inside Next.js server environment.
 * @param {string} tag
 */
async function tryRevalidateTag(tag) {
  try {
    const nextCache = await import("next/cache");
    if (typeof nextCache.revalidateTag === "function") {
      nextCache.revalidateTag(tag);
    }
  } catch {
    // Graceful fallback outside Next.js request context or in CLI
  }
}

/**
 * Builds parameterized WHERE clauses from a condition object, validating column identifiers.
 * @param {Object} where
 * @returns {{whereClauses: string[], params: any[], whereSql: string}}
 */
function buildWhere(where) {
  const whereClauses = [];
  const params = [];
  const opMap = {
    $gt: ">",
    $gte: ">=",
    $lt: "<",
    $lte: "<=",
    $ne: "!=",
    $like: "LIKE",
  };

  for (const [col, val] of Object.entries(where)) {
    if (!/^[a-zA-Z0-9_]+$/.test(col)) {
      throw new Error(`[MODEL ERROR] Invalid column identifier '${col}'`);
    }

    if (Array.isArray(val)) {
      if (val.length === 0) {
        whereClauses.push("1 = 0");
      } else {
        whereClauses.push(`${col} IN (${val.map(() => "?").join(", ")})`);
        params.push(...val);
      }
    } else if (val === null) {
      whereClauses.push(`${col} IS NULL`);
    } else if (typeof val === "object" && val !== null) {
      for (const [op, opVal] of Object.entries(val)) {
        if (op === "$in") {
          if (Array.isArray(opVal) && opVal.length > 0) {
            whereClauses.push(`${col} IN (${opVal.map(() => "?").join(", ")})`);
            params.push(...opVal);
          } else {
            whereClauses.push("1 = 0");
          }
        } else if (op === "$nin") {
          if (Array.isArray(opVal) && opVal.length > 0) {
            whereClauses.push(`${col} NOT IN (${opVal.map(() => "?").join(", ")})`);
            params.push(...opVal);
          } else {
            whereClauses.push("1 = 1");
          }
        } else if (op === "$notNull" && opVal) {
          whereClauses.push(`${col} IS NOT NULL`);
        } else if (op === "$null" && opVal) {
          whereClauses.push(`${col} IS NULL`);
        } else if (opMap[op]) {
          whereClauses.push(`${col} ${opMap[op]} ?`);
          params.push(opVal);
        } else {
          whereClauses.push(`${col} = ?`);
          params.push(opVal);
        }
      }
    } else {
      whereClauses.push(`${col} = ?`);
      params.push(val);
    }
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  return { whereClauses, params, whereSql };
}

/**
 * Validates and builds an ORDER BY clause.
 * @param {string|string[]} [order]
 * @returns {string}
 */
function buildOrder(order) {
  if (!order) return "";
  const rawParts = Array.isArray(order) ? order : String(order).split(",");
  const safeParts = [];

  for (const part of rawParts) {
    const trimmed = String(part).trim();
    if (!trimmed) continue;
    if (!/^[a-zA-Z0-9_]+(\s+(ASC|DESC))?$/i.test(trimmed)) {
      throw new Error(`[MODEL ERROR] Invalid ORDER BY expression '${trimmed}'`);
    }
    safeParts.push(trimmed);
  }

  return safeParts.length > 0 ? `ORDER BY ${safeParts.join(", ")}` : "";
}

/**
 * Lightweight ActiveRecord Model for Next.js and Node.js.
 * Provides schema validation, relationships, soft deletes, DDL generation,
 * and automatic Next.js cache revalidation (revalidateTag).
 */
class Model {
  static table = "models";
  static primaryKey = "id";
  static timestamps = true;
  static softDelete = false;
  static schema = {};
  static _dbInstance = null;

  static getDatabase() {
    return this._dbInstance || database;
  }

  static setDatabase(db) {
    this._dbInstance = db;
  }

  static getCacheTag() {
    return `model:${this.table}`;
  }

  static async invalidateCache() {
    await tryRevalidateTag(this.getCacheTag());
  }

  static filterHidden(row, withHidden = false) {
    if (!row || typeof row !== "object" || withHidden) return row;
    const clean = { ...row };
    for (const [col, config] of Object.entries(this.schema)) {
      if (config.hidden && col in clean) {
        delete clean[col];
      }
    }
    return clean;
  }

  static resolveForeignKey(targetModel) {
    for (const [col, def] of Object.entries(targetModel.schema)) {
      if (def.references === this.table || def.references === `${this.table}.${this.primaryKey}`) {
        return col;
      }
    }

    const singular = this.table.endsWith("s") ? this.table.slice(0, -1) : this.table;
    const candidates = [`${singular}_id`, `${this.table}_id`, `id_${singular}`, `id_${this.table}`];

    for (const c of candidates) {
      if (targetModel.schema[c]) {
        return c;
      }
    }

    return `${singular}_id`;
  }

  static async find(idOrConditions, options = {}) {
    const where = typeof idOrConditions === "object" && idOrConditions !== null
      ? { ...idOrConditions }
      : { [this.primaryKey]: idOrConditions };

    if (this.softDelete && !options.withDeleted && !("deleted_at" in where)) {
      where.deleted_at = null;
    }

    const { params, whereSql } = buildWhere(where);
    const sql = `SELECT * FROM ${this.table} ${whereSql} LIMIT 1`;

    const row = await this.getDatabase().query(sql, params, { return_row: true });
    if (!row) return null;

    let result = this.filterHidden(row, options.withHidden);

    if (options.oneMany) {
      const targets = Array.isArray(options.oneMany) ? options.oneMany : [options.oneMany];
      for (const target of targets) {
        const fk = this.resolveForeignKey(target);
        const related = await target.all({
          where: { [fk]: result[this.primaryKey] },
          withDeleted: options.withDeleted,
          withHidden: options.withHidden,
        });
        result[target.table] = related;
      }
    }

    if (options.belongsTo) {
      const parents = Array.isArray(options.belongsTo) ? options.belongsTo : [options.belongsTo];
      for (const parent of parents) {
        const fk = parent.resolveForeignKey(this);
        const parentId = result[fk];
        if (parentId !== undefined && parentId !== null) {
          const parentRow = await parent.find(parentId, {
            withDeleted: options.withDeleted,
            withHidden: options.withHidden,
          });
          const singularParent = parent.table.endsWith("s") ? parent.table.slice(0, -1) : parent.table;
          result[singularParent] = parentRow;
        }
      }
    }

    return result;
  }

  static async all(options = {}) {
    const where = { ...(options.where || {}) };
    if (this.softDelete && !options.withDeleted && !("deleted_at" in where)) {
      where.deleted_at = null;
    }

    const { params, whereSql } = buildWhere(where);
    const orderSql = buildOrder(options.order);

    let limitSql = "";
    if (options.limit) {
      limitSql = `LIMIT ${parseInt(options.limit, 10)}`;
      if (options.offset) {
        limitSql += ` OFFSET ${parseInt(options.offset, 10)}`;
      }
    }

    const sql = `SELECT * FROM ${this.table} ${whereSql} ${orderSql} ${limitSql}`.trim();
    const rows = (await this.getDatabase().query(sql, params)) || [];
    const results = rows.map((r) => this.filterHidden(r, options.withHidden));

    if (results.length > 0) {
      if (options.oneMany) {
        const targets = Array.isArray(options.oneMany) ? options.oneMany : [options.oneMany];
        const primaryKeys = results.map((r) => r[this.primaryKey]).filter((id) => id !== undefined && id !== null);

        for (const target of targets) {
          const fk = this.resolveForeignKey(target);
          const relatedList = primaryKeys.length > 0
            ? await target.all({
                where: { [fk]: primaryKeys },
                withDeleted: options.withDeleted,
                withHidden: options.withHidden,
              })
            : [];

          const grouped = new Map();
          for (const rel of relatedList) {
            const parentId = rel[fk];
            if (!grouped.has(parentId)) grouped.set(parentId, []);
            grouped.get(parentId).push(rel);
          }

          for (const item of results) {
            item[target.table] = grouped.get(item[this.primaryKey]) || [];
          }
        }
      }

      if (options.belongsTo) {
        const parents = Array.isArray(options.belongsTo) ? options.belongsTo : [options.belongsTo];

        for (const parent of parents) {
          const fk = parent.resolveForeignKey(this);
          const parentIds = [...new Set(results.map((r) => r[fk]).filter((id) => id !== undefined && id !== null))];

          const parentList = parentIds.length > 0
            ? await parent.all({
                where: { [parent.primaryKey]: parentIds },
                withDeleted: options.withDeleted,
                withHidden: options.withHidden,
              })
            : [];

          const parentMap = new Map();
          for (const p of parentList) {
            parentMap.set(p[parent.primaryKey], p);
          }

          const singularParent = parent.table.endsWith("s") ? parent.table.slice(0, -1) : parent.table;
          for (const item of results) {
            item[singularParent] = parentMap.get(item[fk]) || null;
          }
        }
      }
    }

    return results;
  }

  static async paginate(options = {}) {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.max(1, parseInt(options.limit, 10) || 10);
    const where = { ...(options.where || {}) };

    if (this.softDelete && !options.withDeleted && !("deleted_at" in where)) {
      where.deleted_at = null;
    }

    const { params, whereSql } = buildWhere(where);
    const orderSql = buildOrder(options.order);

    const sql = `SELECT * FROM ${this.table} ${whereSql} ${orderSql}`.trim();
    const result = await this.getDatabase().paginate(sql, params, { page, limit });

    result.data = result.data.map((r) => this.filterHidden(r, options.withHidden));
    return result;
  }

  static async create(data = {}) {
    const payload = {};
    const cols = [];
    const placeholders = [];
    const params = [];

    const now = new Date().toISOString();

    for (const [col, def] of Object.entries(this.schema)) {
      if (col === this.primaryKey && def.auto) continue;

      if (col in data) {
        let val = data[col];
        if (def.hash && typeof val === "string" && val.length > 0) {
          const isAlreadyHashed = val.startsWith("$scrypt$") || /^\$2[aby]\$\d{2}\$/.test(val);
          if (!isAlreadyHashed) {
            val = await Hash.make(val);
          }
        }
        payload[col] = val;
      } else if (def.default !== undefined) {
        payload[col] = typeof def.default === "function" ? def.default() : def.default;
      }
    }

    if (this.timestamps) {
      if (!("created_at" in payload)) payload.created_at = now;
      if (!("updated_at" in payload)) payload.updated_at = now;
    }

    for (const [col, val] of Object.entries(payload)) {
      cols.push(col);
      placeholders.push("?");
      params.push(val !== undefined ? val : null);
    }

    const db = this.getDatabase();
    const returningClause = db.type === "postgres" ? ` RETURNING ${this.primaryKey}` : "";
    const sql = `INSERT INTO ${this.table} (${cols.join(", ")}) VALUES (${placeholders.join(", ")})${returningClause}`;
    const insertRes = await db.query(sql, params, db.type === "postgres" ? { return_row: true } : {});
    const insertId =
      db.type === "postgres" && insertRes && typeof insertRes === "object"
        ? insertRes[this.primaryKey]
        : insertRes;

    await this.invalidateCache();
    return insertId;
  }

  static async update(idOrConditions, data = {}) {
    const where = typeof idOrConditions === "object" && idOrConditions !== null
      ? { ...idOrConditions }
      : { [this.primaryKey]: idOrConditions };

    const sets = [];
    const params = [];

    for (const [col, def] of Object.entries(this.schema)) {
      if (col === this.primaryKey) continue;
      if (col in data) {
        let val = data[col];
        if (def.hash && typeof val === "string" && val.length > 0) {
          const isAlreadyHashed = val.startsWith("$scrypt$") || /^\$2[aby]\$\d{2}\$/.test(val);
          if (!isAlreadyHashed) {
            val = await Hash.make(val);
          }
        }
        sets.push(`${col} = ?`);
        params.push(val);
      }
    }

    if (this.timestamps && !("updated_at" in data)) {
      sets.push("updated_at = ?");
      params.push(new Date().toISOString());
    }

    if (sets.length === 0) return 0;

    const { whereClauses, params: whereParams } = buildWhere(where);
    params.push(...whereParams);

    const sql = `UPDATE ${this.table} SET ${sets.join(", ")} WHERE ${whereClauses.join(" AND ")}`;
    const changes = await this.getDatabase().query(sql, params);

    await this.invalidateCache();
    return changes;
  }

  static async delete(idOrConditions, options = {}) {
    const where = typeof idOrConditions === "object" && idOrConditions !== null
      ? { ...idOrConditions }
      : { [this.primaryKey]: idOrConditions };

    if (options.cascade && options.cascade.length > 0) {
      const records = await this.all({ where, withDeleted: true });
      for (const rec of records) {
        const id = rec[this.primaryKey];
        for (const childModel of options.cascade) {
          if (childModel !== this) {
            const fk = this.resolveForeignKey(childModel);
            await childModel.delete({ [fk]: id }, { force: options.force });
          }
        }
      }
    }

    const { whereClauses, params } = buildWhere(where);

    let sql = "";
    if (this.softDelete && !options.force) {
      const now = new Date().toISOString();
      sql = `UPDATE ${this.table} SET deleted_at = ? WHERE ${whereClauses.join(" AND ")}`;
      params.unshift(now);
    } else {
      sql = `DELETE FROM ${this.table} WHERE ${whereClauses.join(" AND ")}`;
    }

    const changes = await this.getDatabase().query(sql, params);
    await this.invalidateCache();
    return changes;
  }

  static async restore(idOrConditions) {
    if (!this.softDelete) return 0;

    const where = typeof idOrConditions === "object" && idOrConditions !== null
      ? { ...idOrConditions }
      : { [this.primaryKey]: idOrConditions };

    const { whereClauses, params } = buildWhere(where);
    const sql = `UPDATE ${this.table} SET deleted_at = NULL WHERE ${whereClauses.join(" AND ")}`;
    const changes = await this.getDatabase().query(sql, params);

    await this.invalidateCache();
    return changes;
  }

  static validator(mode = "create", lang = "es") {
    const rules = {};
    for (const [col, def] of Object.entries(this.schema)) {
      if (col === this.primaryKey && def.auto) continue;
      if (col === "created_at" || col === "updated_at" || col === "deleted_at") continue;

      const rule = { ...def };
      if (mode === "update") {
        rule.required = false;
      }
      rules[col] = rule;
    }

    return new Validator(rules, lang);
  }

  static async first(where = {}, options = {}) {
    return this.find(where, options);
  }

  static async count(where = {}) {
    const conds = { ...where };
    if (this.softDelete && !("deleted_at" in conds)) {
      conds.deleted_at = null;
    }
    const { params, whereSql } = buildWhere(conds);
    const sql = `SELECT COUNT(*) as total FROM ${this.table} ${whereSql}`.trim();
    const row = await this.getDatabase().query(sql, params, { return_row: true });
    return Number(row?.total || row?.count || 0);
  }

  static async exists(where = {}) {
    const total = await this.count(where);
    return total > 0;
  }

  static async firstOrCreate(where, defaults = {}) {
    const existing = await this.find(where);
    if (existing) return existing;
    const newId = await this.create({ ...where, ...defaults });
    return this.find(newId);
  }

  static async updateOrCreate(where, values = {}) {
    const existing = await this.find(where);
    if (existing) {
      const pk = existing[this.primaryKey];
      await this.update(pk, values);
      return this.find(pk);
    }
    const newId = await this.create({ ...where, ...values });
    return this.find(newId);
  }

  static columnToSQL(col, def, dialect = "sqlite") {
    const type = (def.type || "string").toLowerCase();

    if (def.primary) {
      if (dialect === "postgres") {
        return `${col} SERIAL PRIMARY KEY`;
      }
      if (dialect === "mysql") {
        return `${col} INT AUTO_INCREMENT PRIMARY KEY`;
      }
      return `${col} INTEGER PRIMARY KEY AUTOINCREMENT`;
    }

    let typeStr = "VARCHAR(255)";
    if (type === "int" || type === "integer") typeStr = dialect === "postgres" ? "INTEGER" : "INT";
    if (type === "bigint") typeStr = "BIGINT";
    if (type === "float" || type === "double" || type === "decimal") typeStr = "DECIMAL(10,2)";
    if (type === "text") typeStr = "TEXT";
    if (type === "boolean" || type === "bool") typeStr = dialect === "sqlite" ? "INTEGER" : "BOOLEAN";
    if (type === "date" || type === "datetime" || type === "timestamp") {
      typeStr = dialect === "mysql" ? "DATETIME" : "TIMESTAMP";
    }
    if (type === "json") typeStr = dialect === "postgres" ? "JSONB" : (dialect === "sqlite" ? "TEXT" : "JSON");
    if (type === "string") {
      typeStr = `VARCHAR(${def.length || 255})`;
    }

    let sqlCol = `${col} ${typeStr}`;
    if (def.required && !def.nullable) sqlCol += " NOT NULL";
    if (def.unique) sqlCol += " UNIQUE";
    if (def.default !== undefined) {
      const defVal = typeof def.default === "string" ? `'${def.default}'` : def.default;
      sqlCol += ` DEFAULT ${defVal}`;
    }
    return sqlCol;
  }

  static toDDL(dialect = "sqlite") {
    const columns = [];
    const foreignKeys = [];

    for (const [col, def] of Object.entries(this.schema)) {
      columns.push(`  ${this.columnToSQL(col, def, dialect)}`);

      if (def.references) {
        let refTable = "";
        let refCol = "id";
        if (typeof def.references === "string") {
          const parts = def.references.split(".");
          refTable = parts[0];
          if (parts[1]) refCol = parts[1];
        } else if (def.references && def.references.table) {
          refTable = def.references.table;
          if (def.references.column) refCol = def.references.column;
        }

        if (refTable) {
          const onAction = def.onDelete ? def.onDelete.toUpperCase() : (def.nullable ? "SET NULL" : "CASCADE");
          foreignKeys.push(`  FOREIGN KEY (${col}) REFERENCES ${refTable}(${refCol}) ON DELETE ${onAction}`);
        }
      }
    }

    if (this.timestamps) {
      if (!this.schema.created_at) {
        columns.push(dialect === "mysql" ? "  created_at DATETIME DEFAULT CURRENT_TIMESTAMP" : "  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
      }
      if (!this.schema.updated_at) {
        columns.push(dialect === "mysql" ? "  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" : "  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
      }
    }

    if (this.softDelete && !this.schema.deleted_at) {
      columns.push(dialect === "mysql" ? "  deleted_at DATETIME NULL" : "  deleted_at TIMESTAMP NULL");
    }

    const allLines = columns.concat(foreignKeys);
    return `CREATE TABLE IF NOT EXISTS ${this.table} (\n${allLines.join(",\n")}\n);`;
  }
}

export { Model };
export default Model;
