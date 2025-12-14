interface Config {
  apiBaseUrl: string;
}

let config: Config | null = null;

export async function getConfig(): Promise<Config> {
  if (config) {
    return config;
  }

  const response = await fetch("/config.json");
  config = await response.json();
  return config!;
}

export async function getApiBaseUrl(): Promise<string> {
  const cfg = await getConfig();
  return cfg.apiBaseUrl;
}
