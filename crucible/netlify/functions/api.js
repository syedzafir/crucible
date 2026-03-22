/**
 * Netlify serverless function: /api/messages
 * Proxies requests to the Anthropic API.
 * ANTHROPIC_API_KEY must be set in Netlify → Site configuration → Environment variables.
 */
export default async (request) => {
  // Handle CORS preflight
  if(request.method === "OPTIONS"){
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if(request.method !== "POST"){
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if(!apiKey){
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY not configured in Netlify environment variables." }),
      { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch(e) {
    return new Response(
      JSON.stringify({ error: "Invalid JSON in request body." }),
      { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
        // No anthropic-beta header — it caused conflicts with claude-haiku-4-5
      },
      body: JSON.stringify(body),
    });

    // Always parse as text first — Anthropic can return non-JSON on some errors
    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch(e) {
      // Upstream returned non-JSON (e.g. 502/504 HTML error page)
      console.error("[Crucible] Anthropic non-JSON response:", text.slice(0, 200));
      return new Response(
        JSON.stringify({ error: `Upstream error (HTTP ${upstream.status}): ${text.slice(0, 200)}` }),
        { status: 502, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    return new Response(JSON.stringify(data), {
      status: upstream.status,
      headers: {
        "Content-Type":                "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });

  } catch(err) {
    console.error("[Crucible] api.js error:", err.message);
    return new Response(
      JSON.stringify({ error: "Proxy error: " + err.message }),
      { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }
};

export const config = { path: "/api/messages" };
