const API_URL = process.env.API_URL || "http://localhost:8080";

const server = Bun.serve({
	port: 80,
	async fetch(request) {
		const url = new URL(request.url);

		// Serve runtime config
		if (url.pathname === "/config.json") {
			return new Response(JSON.stringify({ apiBaseUrl: API_URL }), {
				headers: { "Content-Type": "application/json" },
			});
		}

		const filePath = `./dist${url.pathname}`;
		const file = Bun.file(filePath);

		if ((await file.exists()) && url.pathname !== "/") {
			return new Response(file);
		}

		// SPA fallback - serve index.html for all routes
		return new Response(Bun.file("./dist/index.html"));
	},
});

console.log(`Static server listening on port ${server.port}`);
console.log(`API_URL configured as: ${API_URL}`);
