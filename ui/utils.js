/**
 * Joins class names, skipping falsy values. Accepts strings, arrays and { "class": condition } objects.
 * Tip: if you need conflicting utilities to be merged (e.g. "px-4" overridden by "px-2"),
 * install `tailwind-merge` and return `twMerge(...)` from here; every component uses this helper.
 * @param {...any} inputs
 * @returns {string}
 */
export function cn(...inputs) {
  const out = [];
  const walk = (value) => {
    if (!value) return;
    if (typeof value === "string" || typeof value === "number") out.push(String(value));
    else if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === "object") {
      for (const [key, on] of Object.entries(value)) if (on) out.push(key);
    }
  };
  inputs.forEach(walk);
  return out.join(" ");
}

/**
 * Returns the message for `field` from a @seip/nextjs Validator result (`errors` array),
 * an object map ({ email: "..." }) or undefined.
 * @example <Input name="email" error={errorFor(state?.errors, "email")} />
 */
export function errorFor(errors, field) {
  if (!errors) return undefined;
  if (Array.isArray(errors)) return errors.find((e) => e?.field === field)?.message;
  const value = errors[field];
  return Array.isArray(value) ? value[0] : value;
}

/** Shared focus ring used by interactive components. */
export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface";
