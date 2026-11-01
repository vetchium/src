// Kept free of imports: each portal's Vite config loads it through Node,
// where portal-ui's own dependencies may not be installed.

export const portalEnvironments = [
  "dev",
  "ci",
  "staging",
  "production",
] as const;
export type PortalEnvironment = (typeof portalEnvironments)[number];

export function parsePortalEnvironment(value: unknown): PortalEnvironment {
  const environment = portalEnvironments.find((name) => name === value);
  if (environment === undefined) {
    throw new Error(
      `VITE_VETCHIUM_ENVIRONMENT must be one of ${portalEnvironments.join(", ")}; got ${JSON.stringify(value)}`,
    );
  }
  return environment;
}

// Staging and production serve the portals and APIs from public HTTPS hosts;
// dev and CI run on plain-HTTP `.localhost` names.
export function servesHTTPS(environment: PortalEnvironment): boolean {
  return environment === "staging" || environment === "production";
}
