export interface QueryOptions {
  return_row?: boolean;
  [key: string]: any;
}

export interface PaginateOptions {
  page?: number;
  limit?: number;
}

export interface PaginateResult<T = any> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class Database {
  type: string;
  init(retries?: number): Promise<boolean>;
  query<T = any>(sql: string, params?: any[], options?: QueryOptions | string): Promise<T>;
  paginate<T = any>(sql: string, params?: any[], options?: PaginateOptions): Promise<PaginateResult<T>>;
  transaction<T = any>(callback: (tx: { query: Database["query"] }) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  static closeAll(): Promise<void>;
}

export const database: Database;
export const db: Database;
export const DB_TYPE: string;

export class Config {
  static setAppDir(dirPath: string): void;
  static appDir(): string;
  static dirname(): string;
  static isDesktop(): boolean;
  static setUserDataDir(dirPath: string): void;
  static userDataDir(): string;
  static props(): Record<string, any>;
  static reload(): void;
}

export interface SchemaField {
  type?: string;
  primary?: boolean;
  auto?: boolean;
  required?: boolean;
  nullable?: boolean;
  unique?: boolean;
  length?: number;
  default?: any;
  hash?: boolean;
  hidden?: boolean;
  references?: string | { table: string; column?: string };
  onDelete?: string;
}

export class Model {
  static table: string;
  static primaryKey: string;
  static timestamps: boolean;
  static softDelete: boolean;
  static schema: Record<string, SchemaField>;

  static getDatabase(): Database;
  static setDatabase(db: Database): void;
  static getCacheTag(): string;
  static invalidateCache(): Promise<void>;
  static find<T = any>(idOrConditions: any, options?: Record<string, any>): Promise<T | null>;
  static all<T = any>(options?: Record<string, any>): Promise<T[]>;
  static paginate<T = any>(options?: PaginateOptions & Record<string, any>): Promise<PaginateResult<T>>;
  static create(data?: Record<string, any>): Promise<number | string>;
  static update(idOrConditions: any, data?: Record<string, any>): Promise<number>;
  static delete(idOrConditions: any, options?: { force?: boolean; cascade?: any[] }): Promise<number>;
  static restore(idOrConditions: any): Promise<number>;
  static first<T = any>(where?: any, options?: Record<string, any>): Promise<T | null>;
  static count(where?: any): Promise<number>;
  static exists(where?: any): Promise<boolean>;
  static firstOrCreate<T = any>(where: any, defaults?: Record<string, any>): Promise<T>;
  static updateOrCreate<T = any>(where: any, values?: Record<string, any>): Promise<T>;
  static toDDL(dialect?: string): string;
  static columnToSQL(col: string, def: SchemaField, dialect?: string): string;
  static validator(mode?: "create" | "update", lang?: string): Validator;
}

export class Auth {
  static encrypt(payload: any, secret?: string): string;
  static decrypt(data: string, secret?: string): any;
  static generateToken(payload: any, secret?: string, expiresIn?: string | number): string;
  static verifyToken(token: string, secret?: string): any;
  static handleProxy(
    request: any,
    options?: {
      protectedRoutes?: string[];
      guestOnlyRoutes?: string[];
      redirectToLogin?: string;
      redirectToDashboard?: string;
      cookieKey?: string;
      secret?: string;
    }
  ): Promise<Response | null>;
  static user(cookiesOrRequest?: any, cookieKey?: string): Promise<any>;
  static revoke(token: string): boolean;
  static login(
    data: any,
    options?: {
      expiresIn?: string | number;
      cookieKey?: string;
      cookieStore?: any;
      secret?: string;
    }
  ): Promise<{ token: string; cookie: any }>;
  static logout(options?: { cookieKey?: string; cookieStore?: any }): Promise<boolean>;
}

export class Hash {
  static make(password: string, options?: Record<string, any>): Promise<string>;
  static hash(password: string, options?: Record<string, any>): Promise<string>;
  static verify(password: string, hash: string): Promise<boolean>;
  static check(password: string, hash: string): Promise<boolean>;
  static needsRehash(hash: string, options?: Record<string, any>): boolean;
}

export class RateLimit {
  static check(
    request: any,
    options?: {
      windowMs?: number;
      max?: number;
      message?: string;
      statusCode?: number;
      keyGenerator?: (req: any) => string;
    }
  ): {
    exceeded: boolean;
    count: number;
    remaining: number;
    resetTime: number;
    response?: Response | null;
  };

  static checkAI(params: {
    key: string;
    limitPerMinute?: number;
    limitPerDay?: number;
  }): {
    exceeded: boolean;
    type?: "minute" | "day";
    message?: string;
    retryAfter?: number;
  };

  static reset(): void;
}

export class IA {
  static cache: { get(key: string): any; set(key: string, value: any): void; has?(key: string): boolean; clear?(): void };
  static resolveSystemPrompt(userQuestion: string, promptDef?: string | ((q: string) => string | Promise<string>)): Promise<string>;
  static getActiveSystemPrompt(userQuestion: string, fallback?: string | ((q: string) => string | Promise<string>)): Promise<string>;
  static callDeepSeek(systemPrompt: string, userMessage: string, options?: Record<string, any>): Promise<string>;
  static callOpenAI(systemPrompt: string, userMessage: string, options?: Record<string, any>): Promise<string>;
  static callClaude(systemPrompt: string, userMessage: string, options?: Record<string, any>): Promise<string>;
  static callGemini(systemPrompt: string, userMessage: string, options?: Record<string, any>): Promise<string>;
  static processChat(params: {
    message: string;
    ip?: string;
    userAgent?: string;
    provider?: "deepseek" | "openai" | "claude" | "gemini";
    systemPrompt?: string | ((q: string) => string | Promise<string>);
    cache?: boolean | { get(k: string): any; set(k: string, v: any): void };
    rateLimit?: boolean;
    limitPerMinute?: number;
    limitPerDay?: number;
    onLog?: (entry: { question: string; response: string; ip: string; userAgent: string; cached: boolean; durationMs: number; blocked?: boolean }) => Promise<void> | void;
    options?: Record<string, any>;
  } | string): Promise<{ data: { response?: string; error?: string; cached?: boolean; retryAfter?: number }; statusCode: number }>;
  static chat(params: any): Promise<{ data: { response?: string; error?: string; cached?: boolean; retryAfter?: number }; statusCode: number }>;
}

export function escapeXss(value: any): string;

export class Validator {
  constructor(schema?: Record<string, any>, lang_default?: string, messages?: any);
  validate(input: any, langOverride?: string): Promise<{
    success: boolean;
    error: boolean;
    errors: Array<{ field: string; message: string }>;
    message: string[];
    data: any;
  }>;
  static sanitizeObject(obj: any): any;
}

export class Upload {
  static getDestination(folder?: string): string;
  static save(
    file: any,
    options?: {
      folder?: string;
      maxSize?: number;
      allowedTypes?: string[];
      allowDangerousExtensions?: boolean;
    }
  ): Promise<{
    filename: string;
    url: string;
    path: string;
    size: number;
    mimeType: string;
  }>;
  static storage(folder?: string, options?: { allowDangerousExtensions?: boolean }): any;
  static disk(options?: {
    folder?: string;
    maxSize?: number;
    fileSize?: number;
    allowedTypes?: string[];
    allowDangerousExtensions?: boolean;
  }): any;
  static url(filename: string, folder?: string): string;
}

export class Seo {
  static registerRoute(routePath: string, languages?: string[]): void;
  static disallow(routes: string | string[]): void;
  static isDisallowed(routePath: string): boolean;
  static getRoutes(): string[];
  static getDisallowed(): string[];
  static clear(): void;
  static generateSitemap(baseUrl?: string): string;
  static generateRobots(baseUrl?: string): string;
  static toNextSitemap(baseUrl?: string): Array<{
    url: string;
    lastModified: Date;
    changeFrequency: string;
    priority: number;
  }>;
  static toNextRobots(baseUrl?: string): {
    rules: { userAgent: string; allow: string; disallow: string[] };
    sitemap: string;
  };
}

export class WebSocketManager {
  constructor(options?: {
    port?: number;
    server?: any;
    path?: string;
    auth?: boolean;
    maxPayload?: number;
  });
  join(room: string, ws: any): void;
  leave(room: string, ws: any): void;
  broadcast(data: any, room?: string | null): void;
  close(): void;
}

export const colors: Record<string, (text: string | number) => string> & {
  bold: Record<string, (text: string | number) => string>;
};

declare const _default: {
  Database: typeof Database;
  database: Database;
  db: Database;
  DB_TYPE: string;
  Config: typeof Config;
  Model: typeof Model;
  Auth: typeof Auth;
  Hash: typeof Hash;
  RateLimit: typeof RateLimit;
  IA: typeof IA;
  Validator: typeof Validator;
  escapeXss: typeof escapeXss;
  Upload: typeof Upload;
  Seo: typeof Seo;
  WebSocketManager: typeof WebSocketManager;
  colors: typeof colors;
};

export default _default;
