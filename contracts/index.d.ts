/**
 * Canonical async contracts (canon v1.1 §3.5) — the single source for every
 * design system. Framework-free by law: pure types, no runtime.
 *
 * LAWS: never sibling booleans; destructive/irreversible/payment mutations are
 * NEVER optimistic; no silent optimism; the error state bundles onRetry and the
 * implementation emits role="alert".
 */

export type AsyncState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "revalidating"; data: T }
  | { status: "error"; error: string; onRetry: () => void; data?: T }
  | { status: "empty" }
  | { status: "success"; data: T };

export type MutationState<E = string> =
  | { status: "idle" }
  | { status: "optimistic" }
  | { status: "error"; error: E }
  | { status: "confirmed" };

/** Error scope a data-based organism declares in its contract. */
export type ErrorScope = "component" | "section" | "page";
