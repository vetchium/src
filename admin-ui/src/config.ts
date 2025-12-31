interface Config {
	apiBaseUrl: string;
}

let config: Config | null = null;

export async function getConfig(): Promise<Config> {
	if (config) {
		return config;
	}

	const response = await fetch("/config.json");
	if (!response.ok) {
		throw new Error(`Failed to load config: ${response.status} ${response.statusText}`);
	}

	const contentType = response.headers.get("content-type");
	if (!contentType || !contentType.includes("application/json")) {
		throw new Error(`Invalid config response: expected JSON, got ${contentType}`);
	}

	config = await response.json();
	return config!;
}

export async function getApiBaseUrl(): Promise<string> {
	const cfg = await getConfig();
	return cfg.apiBaseUrl;
}
