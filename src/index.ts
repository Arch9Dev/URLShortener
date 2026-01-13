// <reference types="@cloudflare/workers-types" />

declare global {
	type D1Database = import('@cloudflare/workers-types').D1Database;
}
export interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Redirect if short code exists
    if (url.pathname.length > 1) {
      const code = url.pathname.slice(1); // remove "/"

      // Fetch from D1
      const row = await env.DB
        .prepare(`SELECT url, clicks FROM links WHERE id = ?`)
        .bind(code)
        .first<{ url: string; clicks: number }>();

      if (!row) return new Response("Short URL not found", { status: 404 });

      // Increment clicks
      await env.DB
        .prepare(`UPDATE links SET clicks = ? WHERE id = ?`)
        .bind(row.clicks + 1, code)
        .run();

      return Response.redirect(row.url, 301);
    }

    // Handle POST to create a new short URL
    if (request.method === "POST") {
      let data: { url?: string };
      try {
        data = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      const { url: longUrl } = data;
      if (!longUrl) return new Response("Missing url", { status: 400 });

      // Generate random 6-character ID
      const id = Math.random().toString(36).substring(2, 8);

      // Store in D1
      const createdAt = new Date().toISOString();
      await env.DB
        .prepare(`INSERT INTO links (id, url, created_at) VALUES (?, ?, ?)`)
        .bind(id, longUrl, createdAt)
        .run();

      return new Response(
        JSON.stringify({ shortUrl: `${url.origin}/${id}` }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Default GET /
    return new Response(
      "Send a POST request with JSON { url: 'https://example.com' }",
      { headers: { "Content-Type": "text/plain" } }
    );
  },
};
