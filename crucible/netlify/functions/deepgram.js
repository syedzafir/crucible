/**
 * Netlify serverless function: /api/deepgram
 * Proxies audio to Deepgram Nova-2 Medical.
 * Set DEEPGRAM_API_KEY in Netlify Environment Variables.
 */
export default async (request) => {
  if(request.method !== "POST"){
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if(!apiKey){
    return new Response(
      JSON.stringify({ error: "DEEPGRAM_API_KEY not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const audioBuffer = await request.arrayBuffer();

    // Strip codec from Content-Type — Deepgram rejects "audio/webm;codecs=opus"
    const rawType    = request.headers.get("Content-Type") || "audio/webm";
    const contentType = rawType.split(";")[0].trim();

    const url = new URL("https://api.deepgram.com/v1/listen");
    url.searchParams.set("model",       "nova-2-medical"); // medical vocabulary
    url.searchParams.set("language",    "en-US");
    url.searchParams.set("punctuate",   "true");   // add punctuation
    url.searchParams.set("numerals",    "true");   // speak numbers → digits
    // smart_format OFF — causes unwanted mid-sentence capitalisation
    // diarize OFF — single speaker dictation
    url.searchParams.set("diarize",     "false");
    url.searchParams.set("utterances",  "false");

    const upstream = await fetch(url.toString(), {
      method:  "POST",
      headers: {
        "Authorization": `Token ${apiKey}`,
        "Content-Type":  contentType,
      },
      body: audioBuffer,
    });

    const data = await upstream.json();

    return new Response(JSON.stringify(data), {
      status:  upstream.status,
      headers: {
        "Content-Type":                "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch(err){
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config = { path: "/api/deepgram" };
