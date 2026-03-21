/**
 * Netlify serverless function: /api/deepgram
 * Proxies audio to Deepgram Nova-2 Medical.
 * Set DEEPGRAM_API_KEY in Netlify Environment Variables.
 *
 * Deepgram Nova-2 Medical is trained on clinical vocabulary —
 * costophrenic, consolidation, bronchiectasis, etc. all recognised accurately.
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
    const contentType = request.headers.get("Content-Type") || "audio/webm";

    // Deepgram Nova-2 Medical — best model for clinical/radiological language
    const url = new URL("https://api.deepgram.com/v1/listen");
    url.searchParams.set("model",       "nova-2-medical");
    url.searchParams.set("language",    "en-US");
    url.searchParams.set("smart_format","true");  // auto punctuation + capitalisation
    url.searchParams.set("numerals",    "true");  // speak numbers, get digits
    url.searchParams.set("punctuate",   "true");

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
