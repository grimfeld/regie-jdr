/** Shared runtime type guards for untrusted values (stored documents, window messages). */

/** A plain object (not null, not an array), whose fields still need checking. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
