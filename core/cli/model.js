import fs from "node:fs";
import path from "node:path";
import colors from "../util/colors.js";

/**
 * Autodetects the appropriate models directory:
 * 1. src/models/ if src/ exists
 * 2. app/models/ if app/ exists
 * 3. models/ fallback
 * @returns {string} Absolute path to models directory.
 */
export function detectModelsDir(customDir = null) {
  if (customDir) return path.resolve(process.cwd(), customDir);
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "src"))) {
    return path.join(cwd, "src", "models");
  }
  if (fs.existsSync(path.join(cwd, "app"))) {
    return path.join(cwd, "app", "models");
  }
  return path.join(cwd, "models");
}

/**
 * Generates a new Model class file.
 * @param {string} name
 * @param {string} [customDir]
 */
export function makeModel(name, customDir = null) {
  if (!name) {
    console.log(colors.red("[ERROR] Missing model name."));
    console.log("Usage: npx @seip/next make:model <Name> [--dir <path>]");
    process.exit(1);
  }

  const cleanName = name.charAt(0).toUpperCase() + name.slice(1).replace(/[^a-zA-Z0-9_]/g, "");
  const tableName = cleanName.toLowerCase().endsWith("s")
    ? cleanName.toLowerCase()
    : `${cleanName.toLowerCase()}s`;

  const modelsDir = detectModelsDir(customDir);
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }

  const filename = `${cleanName.toLowerCase()}.js`;
  const filePath = path.join(modelsDir, filename);

  if (fs.existsSync(filePath)) {
    console.log(colors.yellow(`[WARN] Model file already exists at ${path.relative(process.cwd(), filePath)}`));
    return;
  }

  const template = `import { Model } from "@seip/next";

/**
 * ${cleanName} Model representation.
 * Automatically synchronizes with Next.js caching (revalidateTag) and database migrations.
 */
export default class ${cleanName} extends Model {
  static table = "${tableName}";
  static primaryKey = "id";
  static timestamps = true;
  static softDelete = false;

  static schema = {
    id: { type: "int", primary: true, auto: true },
    name: { type: "string", length: 150, required: true },
    created_at: { type: "date" },
    updated_at: { type: "date" },
  };
}
`;

  fs.writeFileSync(filePath, template, "utf-8");
  console.log(colors.green(`[OK] Model created: ${path.relative(process.cwd(), filePath)}`));
}

const isMain = process.argv[1] && (
  process.argv[1].endsWith("model.js") ||
  process.argv[1].endsWith("model")
);

if (isMain) {
  const args = process.argv.slice(2);
  const modelName = args.find((a, i) => i >= 0 && !a.startsWith("-") && a !== "make:model" && a !== "model");
  makeModel(modelName);
}
