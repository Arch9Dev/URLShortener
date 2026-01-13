export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Redirect if short code exists
    if (url.pathname.length > 1) {
      const code = url.pathname.slice(1); // remove the leading "/"
      const original = await env.URLS.get(code);
      if (original) {
        return Response.redirect(original, 301);
      } else {
        return new Response("Short URL not found", { status: 404 });
      }
    }

    // Handle POST to create short URL
    if (request.method === "POST") {
      const { longUrl } = await request.json();
      if (!longUrl) return new Response("Missing longUrl", { status: 400 });

      // Simple short code generation (random 6 characters)
      const code = Math.random().toString(36).substring(2, 8);
      await env.URLS.put(code, longUrl);

      return new Response(JSON.stringify({ shortUrl: `${url.origin}/${code}` }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // GET / or anything else
    return new Response("Send a POST request with JSON { longUrl: 'https://example.com' }", {
      headers: { "Content-Type": "text/plain" }
    });
  }
};
