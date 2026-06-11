/// Vitest mongoose spies: allow async mock implementations (integration tests).
import 'vitest'

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface MockInstance<T extends (...args: any[]) => any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockImplementation(fn: (...args: any[]) => any): this
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockImplementationOnce(fn: (...args: any[]) => any): this
  }
}
