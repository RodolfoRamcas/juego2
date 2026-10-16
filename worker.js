// Entrada para Cloudflare Workers: sirve public/ y la función /api/preguntas igual que Vercel.
// Adapta el request de Cloudflare al formato (req, res) de api/preguntas.js. Uso: npx wrangler deploy
import preguntas from "./api/preguntas.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/preguntas") return env.ASSETS.fetch(request);

    // La key se guarda con "npx wrangler secret put GEMINI_API_KEY" y llega en env.
    for (const k of ["GEMINI_API_KEY", "GEMINI_MODEL"]) if (env[k]) process.env[k] = env[k];

    let status = 200, body = null;
    const res = {
      status: (c) => ((status = c), res),
      json: (d) => ((body = d), res),
    };
    await preguntas({ method: request.method, body: await request.text() }, res);
    return Response.json(body, { status });
  },
};
