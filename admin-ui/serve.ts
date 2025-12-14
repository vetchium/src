const server = Bun.serve({
  port: 80,
  async fetch(request) {
    const url = new URL(request.url);
    const filePath = `./dist${url.pathname}`;
    const file = Bun.file(filePath);

    if (await file.exists() && url.pathname !== "/") {
      return new Response(file);
    }

    // SPA fallback - serve index.html for all routes
    return new Response(Bun.file("./dist/index.html"));
  },
});

console.log(`Static server listening on port ${server.port}`);
