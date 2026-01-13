// <reference types="@cloudflare/workers-types" />

declare global {
	type D1Database = import('@cloudflare/workers-types').D1Database;
}
// <reference types="@cloudflare/workers-types" />

export interface Env {
  DB: D1Database;
}

// Generate unique ID with collision checking
async function generateUniqueId(env: Env): Promise<string> {
  let attempts = 0;
  const maxAttempts = 10;
  
  while (attempts < maxAttempts) {
    // Generate random 6-character ID
    const id = Math.random().toString(36).substring(2, 8);
    
    // Check if ID already exists in database
    const existing = await env.DB
      .prepare(`SELECT id FROM links WHERE id = ?`)
      .bind(id)
      .first();
    
    // If ID doesn't exist, we can use it
    if (!existing) {
      return id;
    }
    
    attempts++;
  }
  
  // Fallback: if we hit too many collisions, generate a longer ID
  return Math.random().toString(36).substring(2, 10);
}

// Validate URL format
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// CORS headers for frontend access
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function corsResponse(body: BodyInit | null, init?: ResponseInit): Response {
  const response = new Response(body, init);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return corsResponse(null, { status: 204 });
    }

    // Handle POST to create a new short URL
    if (request.method === "POST") {
      let data: { url?: string };
      try {
        data = await request.json();
      } catch {
        return corsResponse(
          JSON.stringify({ error: "Invalid JSON" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const { url: longUrl } = data;
      
      if (!longUrl) {
        return corsResponse(
          JSON.stringify({ error: "Missing url field" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      
      // Validate URL
      if (!isValidUrl(longUrl)) {
        return corsResponse(
          JSON.stringify({ error: "Invalid URL format. Must be http:// or https://" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // Generate unique ID with collision checking
      const id = await generateUniqueId(env);
      const createdAt = new Date().toISOString();
      
      try {
        // Store in D1
        await env.DB
          .prepare(`INSERT INTO links (id, url, created_at) VALUES (?, ?, ?)`)
          .bind(id, longUrl, createdAt)
          .run();

        return corsResponse(
          JSON.stringify({ 
            shortUrl: `${url.origin}/${id}`,
            id: id
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      } catch (error) {
        return corsResponse(
          JSON.stringify({ error: "Database error occurred" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Redirect if short code exists
    if (url.pathname.length > 1) {
      const code = url.pathname.slice(1); // remove "/"

      // Fetch from D1
      const row = await env.DB
        .prepare(`SELECT url, clicks FROM links WHERE id = ?`)
        .bind(code)
        .first<{ url: string; clicks: number }>();

      if (!row) {
        return new Response("Short URL not found", { status: 404 });
      }

      // Increment clicks (fire-and-forget to avoid slowing down redirect)
      env.DB
        .prepare(`UPDATE links SET clicks = ? WHERE id = ?`)
        .bind(row.clicks + 1, code)
        .run()
        .catch(() => {}); // Ignore errors silently

      return Response.redirect(row.url, 301);
    }

    // Default GET / - show API info
    return corsResponse(
      JSON.stringify({
        message: "URL Shortener API",
        usage: "Send POST request with JSON { url: 'https://example.com' }",
        endpoints: {
          "POST /": "Create short URL",
          "GET /:code": "Redirect to original URL"
        }
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  },
};