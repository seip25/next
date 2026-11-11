import { Database, database, db, DB_TYPE } from "./core/database.js";
import { Config } from "./core/config.js";
import { Model } from "./core/model.js";
import { Auth } from "./core/auth.js";
import { Hash } from "./core/hash.js";
import { RateLimit } from "./core/ratelimit.js";
import { IA } from "./core/ia.js";
import { Validator, escapeXss } from "./core/validate.js";
import { Upload } from "./core/upload.js";
import { Seo } from "./core/seo.js";
import { WebSocketManager } from "./core/ws.js";
import { colors } from "./core/util/colors.js";
import { registerModule } from "./core/util/optional.js";
import { TableQuery } from "./core/table.js";

export {
  Database,
  database,
  db,
  DB_TYPE,
  Config,
  Model,
  Auth,
  Hash,
  RateLimit,
  IA,
  Validator,
  escapeXss,
  Upload,
  Seo,
  WebSocketManager,
  colors,
  registerModule,
  TableQuery,
};

export default {
  Database,
  database,
  db,
  DB_TYPE,
  Config,
  Model,
  Auth,
  Hash,
  RateLimit,
  IA,
  Validator,
  escapeXss,
  Upload,
  Seo,
  WebSocketManager,
  colors,
  registerModule,
  TableQuery,
};
