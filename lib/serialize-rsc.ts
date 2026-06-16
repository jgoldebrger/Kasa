/** Flatten Mongoose lean docs / ObjectIds for RSC props without JSON double-parse cost on huge trees. */
export function serializeForRsc<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
