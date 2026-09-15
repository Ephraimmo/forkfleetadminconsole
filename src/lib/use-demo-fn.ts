/**
 * Demo shim: pages were written against TanStack Start's `useServerFn`, which
 * wraps server functions so callers always pass a single `{ data: payload }`
 * argument (and the same shape is returned). In demo mode the underlying
 * function is a plain async function that takes the payload directly. This
 * adapter accepts both `fn(payload)` and `fn(payload)` call shapes
 * and always unwraps to a direct payload, so existing call sites don't break.
 */
type AnyFn = (...args: any[]) => any;

function unwrapArg(arg: unknown): unknown {
  if (arg && typeof arg === "object" && "data" in (arg as Record<string, unknown>)) {
    return (arg as { data?: unknown }).data;
  }
  return arg;
}

export function useServerFn<T extends AnyFn>(fn: T): T {
  return ((input?: unknown) => fn(unwrapArg(input))) as T;
}
