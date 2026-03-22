/**
 * /api/deepgram-token — Netlify serverless function
 *
 * Returns the Deepgram API key to the browser so it can authenticate
 * a WebSocket connection. The key never touches frontend source code.
 *
 * HOW TO SET THE KEY IN NETLIFY:
 *   Site configuration → Environment variables → Add variable
 *   Key:   DEEPGRAM_API_KEY
 *   Value: your key from console.deepgram.com
 *          IMPORTANT: paste ONLY the raw key — do NOT include "Token "
 *          ✓  abc123xyz...
 *          ✗  Token abc123xyz...
 *
 * After adding the key, trigger a redeploy:
 *   Deploys → Trigger deploy → Deploy site
 */
export default async (request) => {
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

  let key = (process.env.DEEPGRAM_API_KEY || "").trim();

  if(!key){
    console.error("[Crucible] DEEPGRAM_API_KEY is not set in Netlify environment variables");
    return new Response(
      JSON.stringify({ error: "DEEPGRAM_API_KEY not configured. Add it in Netlify → Site configuration → Environment variables." }),
      { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }

  // Strip accidental "Token " prefix
  key = key.replace(/^Token\s+/i, "").trim();

  // Basic sanity check — Deepgram keys are long alphanumeric strings
  if(key.length < 20){
    console.error("[Crucible] DEEPGRAM_API_KEY looks malformed (too short)");
    return new Response(
      JSON.stringify({ error: "DEEPGRAM_API_KEY looks malformed. Check the value in Netlify environment variables." }),
      { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }

  return new Response(
    JSON.stringify({ key }),
    { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
  );
};

export const config = { path: "/api/deepgram-token" };
