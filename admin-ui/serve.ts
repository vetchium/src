const API_URL = process.env.API_URL || "http://localhost:8080";

const server = Bun.serve({
	port: 80,
	async fetch(request) {
		try {
			const url = new URL(request.url);

			// Serve runtime config
			if (url.pathname === "/config.json") {
				return new Response(JSON.stringify({ apiBaseUrl: API_URL }), {
					headers: { "Content-Type": "application/json" },
				});
			}

			const filePath = `./dist${url.pathname}`;
			try {
				const file = Bun.file(filePath);
				if ((await file.exists()) && url.pathname !== "/") {
					return new Response(file);
				}
			} catch {
				// file doesn't exist or path error — fall through to SPA fallback
			}

			// SPA fallback - serve index.html for all routes
			return new Response(Bun.file("./dist/index.html"), {
				headers: { "Content-Type": "text/html; charset=utf-8" },
			});
		} catch (err) {
			console.error("Request error:", err);
			return new Response("Internal Server Error", { status: 500 });
		}
	},
	error(err) {
		console.error("Server error:", err);
		return new Response("Internal Server Error", { status: 500 });
	},
});

console.log(`Static server listening on port ${server.port}`);
console.log(`API_URL configured as: ${API_URL}`);
