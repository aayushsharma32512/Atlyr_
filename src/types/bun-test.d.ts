// `bun:test` has no types here — bun-types is not installed — so tsc could not
// resolve any `.test.ts` that imports it. The API is jest-compatible (see
// CLAUDE.md), so it maps onto the @types/jest that is installed.
declare module "bun:test" {
  export const describe: jest.Describe
  export const it: jest.It
  export const test: jest.It
  export const expect: jest.Expect
  export const beforeAll: jest.Lifecycle
  export const beforeEach: jest.Lifecycle
  export const afterAll: jest.Lifecycle
  export const afterEach: jest.Lifecycle
  // bun adds `mock.module(specifier, factory)` on top of the jest-style `mock(fn)`.
  export const mock: typeof jest.fn & { module: (specifier: string, factory: () => unknown) => void }
  export const spyOn: typeof jest.spyOn
}
