import { serve } from "bun";
import index from "./index.html";

const API_URL = process.env.API_URL || "http://localhost:8080";

const server = serve({
	port: 3003,
	routes: {
		// Serve runtime config
		"/config.json": () => Response.json({ apiBaseUrl: API_URL }),

		// Serve index.html for all unmatched routes.
		"/*": index,

		"/api/hello": {
			async GET(_req) {
				return Response.json({
					message: "Hello, world!",
					method: "GET",
				});
			},
			async PUT(_req) {
				return Response.json({
					message: "Hello, world!",
					method: "PUT",
				});
			},
		},

		"/api/hello/:name": async (req) => {
			const name = req.params.name;
			return Response.json({
				message: `Hello, ${name}!`,
			});
		},
	},

	development: process.env.NODE_ENV !== "production" && {
		// Enable browser hot reloading in development
		hmr: true,

		// Echo console logs from the browser to the server
		console: true,
	},
});

console.log(`Server running at ${server.url}`);
