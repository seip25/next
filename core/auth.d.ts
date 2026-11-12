export { Auth, Auth as default } from "../index.js";

/**
 * True for the control-flow errors Next.js throws on purpose (DYNAMIC_SERVER_USAGE,
 * HANGING_PROMISE_REJECTION, redirect/notFound, PPR postpone). Rethrow them from your own catch blocks.
 */
export function isNextInternalError(err: unknown): boolean;
