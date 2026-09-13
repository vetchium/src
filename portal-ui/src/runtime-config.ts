/**
 * Reads one member of the runtime configuration every portal's static
 * container writes to `globalThis.__VETCHIUM_CONFIG__`. Returns `undefined`
 * when the global or the member is absent. Stays portal-agnostic: callers
 * name the member and validate the returned value themselves.
 */
export function runtimeConfigValue(name: string): unknown {
  const config = (
    globalThis as typeof globalThis & { __VETCHIUM_CONFIG__?: unknown }
  ).__VETCHIUM_CONFIG__;
  if (typeof config !== "object" || config === null) return undefined;
  return (config as Record<string, unknown>)[name];
}
