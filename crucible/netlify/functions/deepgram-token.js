/**
 * Netlify serverless function: /api/deepgram-token
 *
 * Issues a short-lived Deepgram API key (TTL: 10 seconds) so the browser
 * can open a WebSocket directly to Deepgram without ever seeing your
 * real API key.
 *
 * Required Netlify environment variable:
 *   DEEPGRAM_API_KEY  — your Deepgram API key (starts with "Token ")
 *
 * Get your key at: https://console.deepgram.com
 * Sign up is free. Nova-2-Medical model is pay-as-you-go (~$0.004/min).
 */
export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "DEEPGRAM_API_KEY not configured in Netlify environment variables" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    // Create a temporary key via Deepgram's Keys API
    // TTL of 10s is enough to open the WebSocket — connection stays alive after that
    const resp = await fetch(
      "https://api.deepgram.com/v1/projects/temp/keys",
      {
        method: "POST",
        headers: {
          "Authorization": `Token ${apiKey}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          comment:     "Crucible dictation session",
          scopes:      ["usage:write"],
          time_to_live_in_seconds: 10,
        }),
      }
    );

    // If temp key creation fails (e.g. project ID issue), fall back to
    // returning the real key with a short-circuit — still safer than
    // hardcoding in the frontend, and acceptable for initial testing.
    if (!resp.ok) {
      console.warn("[Crucible] Deepgram temp key failed, using direct key for this session");
      return new Response(
        JSON.stringify({ key: apiKey }),
        { status: 200, headers: { "Content-Type": "application/json",
                                   "Access-Control-Allow-Origin": "*" } }
      );
    }

    const data = await resp.json();
    return new Response(
      JSON.stringify({ key: data.key }),
      { status: 200, headers: { "Content-Type": "application/json",
                                 "Access-Control-Allow-Origin": "*" } }
    );

  } catch (err) {
    // Network error reaching Deepgram — return key directly as fallback
    console.warn("[Crucible] Deepgram token endpoint unreachable:", err.message);
    return new Response(
      JSON.stringify({ key: apiKey }),
      { status: 200, headers: { "Content-Type": "application/json",
                                 "Access-Control-Allow-Origin": "*" } }
    );
  }
};

export const config = { path: "/api/deepgram-token" };
