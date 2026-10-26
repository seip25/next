/**
 * Escapes HTML special characters to prevent XSS.
 * @param {string} value
 * @returns {string}
 */
export function escapeXss(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

const messages_default = {
  es: {
    required: (f) => `El campo ${f} es obligatorio`,
    min: (f, n) => `El campo ${f} debe tener al menos ${n} caracteres`,
    max: (f, n) => `El campo ${f} no puede tener más de ${n} caracteres`,
    email: (f) => `El campo ${f} debe ser un email válido`,
    number: (f) => `El campo ${f} debe ser numérico`,
    alpha: (f) => `El campo ${f} solo puede contener letras`,
    alphanumeric: (f) => `El campo ${f} solo puede contener letras y números`,
    boolean: (f) => `El campo ${f} debe ser verdadero o falso`,
    date: (f) => `El campo ${f} debe ser una fecha válida`,
    url: (f) => `El campo ${f} debe ser una URL válida`,
    in: (f, v) => `El campo ${f} debe ser uno de: ${v.join(", ")}`,
    equals: (f, v) => `El campo ${f} debe ser igual a ${v}`,
    password: () => `La contraseña debe tener mayúsculas, minúsculas y números`,
    pattern: (f) => `El campo ${f} no cumple el patrón requerido`,
  },
  en: {
    required: (f) => `${f} is required`,
    min: (f, n) => `${f} must be at least ${n} characters`,
    max: (f, n) => `${f} must be at most ${n} characters`,
    email: (f) => `${f} must be a valid email`,
    number: (f) => `${f} must be numeric`,
    alpha: (f) => `${f} must contain only letters`,
    alphanumeric: (f) => `${f} must contain only letters and numbers`,
    boolean: (f) => `${f} must be true or false`,
    date: (f) => `${f} must be a valid date`,
    url: (f) => `${f} must be a valid URL`,
    in: (f, v) => `${f} must be one of: ${v.join(", ")}`,
    equals: (f, v) => `${f} must equal ${v}`,
    password: () => `Password must contain uppercase, lowercase and numbers`,
    pattern: (f) => `${f} does not match the required pattern`,
  },
  pt: {
    required: (f) => `O campo ${f} é obrigatório`,
    min: (f, n) => `O campo ${f} deve ter pelo menos ${n} caracteres`,
    max: (f, n) => `O campo ${f} não pode ter mais de ${n} caracteres`,
    email: (f) => `O campo ${f} deve ser um email válido`,
    number: (f) => `O campo ${f} deve ser numérico`,
    alpha: (f) => `O campo ${f} só pode conter letras`,
    alphanumeric: (f) => `O campo ${f} só pode conter letras e números`,
    boolean: (f) => `O campo ${f} deve ser verdadeiro ou falso`,
    date: (f) => `O campo ${f} deve ser uma data válida`,
    url: (f) => `O campo ${f} deve ser uma URL válida`,
    in: (f, v) => `O campo ${f} deve ser um de: ${v.join(", ")}`,
    equals: (f, v) => `O campo ${f} deve ser igual a ${v}`,
    password: () => `A senha deve conter maiúsculas, minúsculas e números`,
    pattern: (f) => `O campo ${f} não corresponde ao padrão exigido`,
  },
  br: {
    required: (f) => `O campo ${f} é obrigatório`,
    min: (f, n) => `O campo ${f} deve ter pelo menos ${n} caracteres`,
    max: (f, n) => `O campo ${f} não pode ter mais de ${n} caracteres`,
    email: (f) => `O campo ${f} deve ser um email válido`,
    number: (f) => `O campo ${f} deve ser numérico`,
    alpha: (f) => `O campo ${f} só pode conter letras`,
    alphanumeric: (f) => `O campo ${f} só pode conter letras e números`,
    boolean: (f) => `O campo ${f} deve ser verdadeiro ou falso`,
    date: (f) => `O campo ${f} deve ser uma data válida`,
    url: (f) => `O campo ${f} deve ser uma URL válida`,
    in: (f, v) => `O campo ${f} deve ser um de: ${v.join(", ")}`,
    equals: (f, v) => `O campo ${f} deve ser igual a ${v}`,
    password: () => `A senha deve conter maiúsculas, minúsculas e números`,
    pattern: (f) => `O campo ${f} não corresponde ao padrão exigido`,
  },
  fr: {
    required: (f) => `Le champ ${f} est obligatoire`,
    min: (f, n) => `Le champ ${f} doit contenir au moins ${n} caractères`,
    max: (f, n) => `Le champ ${f} ne peut pas contenir plus de ${n} caractères`,
    email: (f) => `Le champ ${f} doit être un email valide`,
    number: (f) => `Le champ ${f} doit être numérique`,
    alpha: (f) => `Le champ ${f} ne peut contenir que des lettres`,
    alphanumeric: (f) => `Le champ ${f} ne peut contenir que des lettres et des chiffres`,
    boolean: (f) => `Le champ ${f} doit être vrai ou faux`,
    date: (f) => `Le champ ${f} doit être une date valide`,
    url: (f) => `Le champ ${f} doit être une URL valide`,
    in: (f, v) => `Le champ ${f} doit être l'un de: ${v.join(", ")}`,
    equals: (f, v) => `Le champ ${f} doit être égal à ${v}`,
    password: () => `Le mot de passe doit contenir des majuscules, des minuscules et des chiffres`,
    pattern: (f) => `Le champ ${f} ne correspond pas au modèle requis`,
  },
};

const validators = {
  isEmpty: (value) => value === undefined || value === null || value === "",
  isEmail: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
  isNumeric: (value) => !isNaN(value) && !isNaN(parseFloat(value)),
  isAlpha: (value) => /^[a-zA-Z]+$/.test(value),
  isAlphanumeric: (value) => /^[a-zA-Z0-9]+$/.test(value),
  isBoolean: (value) =>
    value === true || value === false || value === "true" || value === "false",
  isISO8601: (value) => !isNaN(Date.parse(value)),
  isURL: (value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  },
  isLength: (value, { min, max }) => {
    const len = String(value).length;
    if (min !== undefined && len < min) return false;
    if (max !== undefined && len > max) return false;
    return true;
  },
  isIn: (value, values) => values.includes(value),
  equals: (value, comparison) => value === comparison,
  matches: (value, pattern) => {
    if (pattern instanceof RegExp) {
      pattern.lastIndex = 0;
      return pattern.test(String(value));
    }
    return new RegExp(pattern).test(String(value));
  },
};

/**
 * Universal validation engine for Server Actions, Route Handlers, and FormData.
 */
class Validator {
  constructor(schema = {}, lang_default = "es", messages = null) {
    this.schema = schema || {};
    this.lang_default = lang_default;
    this.messages = messages ? messages : messages_default;
  }

  /**
   * Validates plain objects, FormData, or Request payloads.
   * @param {Object|FormData} input
   * @param {string} [langOverride]
   * @returns {Promise<{success: boolean, error: boolean, errors: Array<{field: string, message: string}>, message: string[], data: Object}>}
   */
  async validate(input, langOverride = null) {
    let body = {};

    if (input && typeof input.entries === "function") {
      // FormData or URLSearchParams
      for (const [key, val] of input.entries()) {
        body[key] = val;
      }
    } else if (input && typeof input.json === "function") {
      // NextRequest
      try {
        body = await input.json();
      } catch {
        body = {};
      }
    } else if (input && typeof input === "object") {
      body = input.body ? input.body : { ...input };
    }

    const lang = langOverride || this.lang_default || "es";
    const msg = this.messages[lang] || this.messages.es || this.messages.en;
    const errors = [];
    const messages = [];
    const sanitizedData = { ...body };

    for (const [field, config] of Object.entries(this.schema)) {
      let value = sanitizedData[field];

      if (config.xss === true && typeof value === "string") {
        sanitizedData[field] = escapeXss(value);
        value = sanitizedData[field];
      }

      if (config.required && validators.isEmpty(value)) {
        const errorMsg = config.messages?.required || msg.required(field);
        messages.push(errorMsg);
        errors.push({ field, message: errorMsg });
        continue;
      }

      if (!validators.isEmpty(value)) {
        if (
          config.min !== undefined &&
          !validators.isLength(value, { min: config.min })
        ) {
          const errorMsg = config.messages?.min || msg.min(field, config.min);
          messages.push(errorMsg);
          errors.push({ field, message: errorMsg });
        }
        if (
          config.max !== undefined &&
          !validators.isLength(value, { max: config.max })
        ) {
          const errorMsg = config.messages?.max || msg.max(field, config.max);
          messages.push(errorMsg);
          errors.push({ field, message: errorMsg });
        }
        if (config.email && !validators.isEmail(value)) {
          const errorMsg = config.messages?.email || msg.email(field);
          messages.push(errorMsg);
          errors.push({ field, message: errorMsg });
        }
        if (config.number && !validators.isNumeric(value)) {
          const errorMsg = config.messages?.number || msg.number(field);
          messages.push(errorMsg);
          errors.push({ field, message: errorMsg });
        }
        if (config.alpha && !validators.isAlpha(value)) {
          const errorMsg = config.messages?.alpha || msg.alpha(field);
          messages.push(errorMsg);
          errors.push({ field, message: errorMsg });
        }
        if (config.alphanumeric && !validators.isAlphanumeric(value)) {
          const errorMsg = config.messages?.alphanumeric || msg.alphanumeric(field);
          messages.push(errorMsg);
          errors.push({ field, message: errorMsg });
        }
        if (config.boolean && !validators.isBoolean(value)) {
          const errorMsg = config.messages?.boolean || msg.boolean(field);
          messages.push(errorMsg);
          errors.push({ field, message: errorMsg });
        }
        if (config.date && !validators.isISO8601(value)) {
          const errorMsg = config.messages?.date || msg.date(field);
          messages.push(errorMsg);
          errors.push({ field, message: errorMsg });
        }
        if (config.url && !validators.isURL(value)) {
          const errorMsg = config.messages?.url || msg.url(field);
          messages.push(errorMsg);
          errors.push({ field, message: errorMsg });
        }
        if (config.in && !validators.isIn(value, config.in)) {
          const errorMsg = config.messages?.in || msg.in(field, config.in);
          messages.push(errorMsg);
          errors.push({ field, message: errorMsg });
        }
        if (
          config.equals !== undefined &&
          !validators.equals(value, config.equals)
        ) {
          const errorMsg = config.messages?.equals || msg.equals(field, config.equals);
          messages.push(errorMsg);
          errors.push({ field, message: errorMsg });
        }
        if (
          config.password &&
          !validators.matches(value, /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{6,}$/)
        ) {
          const errorMsg = config.messages?.password || msg.password(field);
          messages.push(errorMsg);
          errors.push({ field, message: errorMsg });
        }
        if (config.pattern && !validators.matches(value, config.pattern)) {
          const errorMsg = config.messages?.pattern || msg.pattern(field);
          messages.push(errorMsg);
          errors.push({ field, message: errorMsg });
        }
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        error: true,
        errors,
        message: messages,
        data: sanitizedData,
      };
    }

    return {
      success: true,
      error: false,
      errors: [],
      message: [],
      data: sanitizedData,
    };
  }

  static sanitizeObject(obj) {
    if (typeof obj === "string") return escapeXss(obj);
    if (Array.isArray(obj)) return obj.map((item) => Validator.sanitizeObject(item));
    if (typeof obj === "object" && obj !== null) {
      const sanitized = {};
      for (const key in obj) {
        sanitized[key] = Validator.sanitizeObject(obj[key]);
      }
      return sanitized;
    }
    return obj;
  }
}

export { Validator };
export default Validator;
