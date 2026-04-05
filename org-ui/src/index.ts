import { serve } from "bun";
import { join } from "path";

const API_URL = process.env.API_URL || "http://localhost:8080";
const ASSETS_DIR = join(import.meta.dir, "..", "dist");

const server = serve({
	port: 3002,
	async fetch(req) {
		const url = new URL(req.url);

		// Serve runtime config
		if (url.pathname === "/config.json") {
			return Response.json({ apiBaseUrl: API_URL });
		}

		// Try to serve static files from dist directory

		let pathName = url.pathname;
		if (pathName === "/") pathName = "/index.html";

		const filePath = join(ASSETS_DIR, pathName);
		const file = Bun.file(filePath);

		if (await file.exists()) {
			// Don't serve directories
			if (file.size > 0) {
				return new Response(file);
			}
		}

		// API Hello routes
		if (url.pathname === "/api/hello") {
			if (req.method === "GET") {
				return Response.json({ message: "Hello, world!", method: "GET" });
			}
			if (req.method === "PUT") {
				return Response.json({ message: "Hello, world!", method: "PUT" });
			}
		}

		if (url.pathname.startsWith("/api/hello/")) {
			const name = url.pathname.split("/").pop();
			return Response.json({ message: `Hello, ${name}!` });
		}

		// Fallback to index.html for SPA routing
		return new Response(Bun.file(join(ASSETS_DIR, "index.html")), {
			headers: { "Content-Type": "text/html" },
		});
	},

	development: process.env.NODE_ENV !== "production" && {
		// Enable browser hot reloading in development
		hmr: true,

		// Echo console logs from the browser to the server
		console: true,
	},
});

console.log(`🚀 Server running at ${server.url}`);
