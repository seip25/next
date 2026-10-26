import { styleText } from "node:util";

/**
 * ANSI color formatting utilities powered by Node.js native styleText.
 * Provides a lightweight, zero-dependency alternative to chalk.
 */
const colors = {
  bold: (text) => styleText("bold", String(text)),
  green: (text) => styleText("green", String(text)),
  red: (text) => styleText("red", String(text)),
  blue: (text) => styleText("blue", String(text)),
  yellow: (text) => styleText("yellow", String(text)),
  cyan: (text) => styleText("cyan", String(text)),
  magenta: (text) => styleText("magenta", String(text)),
  gray: (text) => styleText("gray", String(text)),
  white: (text) => styleText("white", String(text)),
};

colors.bold.green = (text) => styleText(["bold", "green"], String(text));
colors.bold.red = (text) => styleText(["bold", "red"], String(text));
colors.bold.blue = (text) => styleText(["bold", "blue"], String(text));
colors.bold.cyan = (text) => styleText(["bold", "cyan"], String(text));
colors.bold.yellow = (text) => styleText(["bold", "yellow"], String(text));
colors.bold.magenta = (text) => styleText(["bold", "magenta"], String(text));

export { colors };
export default colors;
