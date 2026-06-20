export function mockConstructor<T>(factory: () => T): (...args: unknown[]) => T {
  return function MockConstructor(): T {
    return factory();
  };
}
