import { GoogleGenAI } from "@google/genai";

// Función serverless de Vercel: POST /api/preguntas { cantidad, evitar, temasRecientes } -> { preguntas: [...] }
// La key vive solo aquí, en la variable de entorno GEMINI_API_KEY (Vercel o archivo .env); nunca llega al navegador.
// Si el modelo principal está saturado ("alta demanda" en el plan gratuito), se prueban los siguientes.
const MODELOS = [
  ...new Set([process.env.GEMINI_MODEL || "gemini-3.8-flash", "gemini-3.7-flash", "gemini-flash-latest", "gemini-3.5-flash-lite"]),
];

export const TEMAS = [
  "Programación",
  "Estructuras de datos y algoritmos",
  "Bases de datos",
  "Redes",
  "Ciberseguridad",
  "Inteligencia artificial",
  "Blockchain y criptomonedas",
  "Sistemas operativos",
  "Hardware y arquitectura de computadoras",
  "Cloud y DevOps",
  "Desarrollo web",
  "Ingeniería de software",
  "Linux y línea de comandos",
  "Historia de la computación",
  "Matemáticas para computación",
];

const ESQUEMA = {
  type: "object",
  properties: {
    preguntas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tema: { type: "string" },
          q: { type: "string" },
          o: { type: "array", items: { type: "string" } },
          a: { type: "integer" },
        },
        required: ["tema", "q", "o", "a"],
        additionalProperties: false,
      },
    },
  },
  required: ["preguntas"],
  additionalProperties: false,
};

const INSTRUCCIONES = `Eres el autor de preguntas de "Duelo de Sistemas", un juego de trivia en español donde dos jugadores compiten respondiendo desde su teléfono con 15 segundos por pregunta.

Cada pregunta:
- Se lee y se responde en menos de 15 segundos: enunciado de una o dos líneas.
- Tiene exactamente 4 opciones cortas (máximo 40 caracteres) y una sola correcta, sin ambigüedad ni "todas las anteriores".
- Los distractores son plausibles para alguien que no domina el tema.
- "a" es el índice (0-3) de la opción correcta.
- "tema" es exactamente el tema asignado a esa posición.

Escribe en texto plano con caracteres normales (á, é, ñ, ¿, ¡). Nunca uses entidades HTML como &eacute; ni Markdown.

Variedad: mezcla dificultad (fácil, media y alguna difícil) y tipo de pregunta (conceptos, siglas, comandos, "qué hace este código", historia, casos prácticos). No repitas ninguna pregunta de la lista de evitar ni preguntes sobre el mismo concepto con otras palabras.`;

// Algunos modelos devuelven entidades HTML (&eacute;, &iquest;, &#233;) aunque se les pida texto plano.
const ENTIDADES = {
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü",
  iquest: "¿", iexcl: "¡", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", amp: "&",
};
const limpiar = (t) =>
  String(t).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTIDADES[e] ?? m,
  );

// Orden de temas para el lote: barajado, sin repetir tema seguido ni empezar por uno usado hace poco.
function ordenDeTemas(cantidad, recientes) {
  const orden = [];
  let bolsa = [];
  while (orden.length < cantidad) {
    if (!bolsa.length) bolsa = [...TEMAS].sort(() => Math.random() - 0.5);
    const anterior = orden.at(-1);
    const evitar = orden.length === 0 ? recientes : [anterior];
    const i = bolsa.findIndex((t) => !evitar.includes(t));
    orden.push(bolsa.splice(i === -1 ? 0 : i, 1)[0]);
  }
  return orden;
}


export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Usa POST" });
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: "Falta GEMINI_API_KEY" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const cantidad = Math.min(Math.max(Number(body.cantidad) || 10, 1), 15);
  const texto = (lista, n) => (Array.isArray(lista) ? lista.slice(-n).map((t) => String(t).slice(0, 200)) : []);
  const evitar = texto(body.evitar, 60);
  const temasRecientes = texto(body.temasRecientes, 3);
  const temas = ordenDeTemas(cantidad, temasRecientes);

  const pedido =
    `Genera ${cantidad} preguntas, una por tema y en este orden:\n` +
    temas.map((t, i) => `${i + 1}. ${t}`).join("\n") +
    (evitar.length ? `\n\nPreguntas que ya salieron (no repitas ni reformules ninguna):\n- ${evitar.join("\n- ")}` : "");

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  for (const modelo of MODELOS) {
    try {
      const response = await ai.models.generateContent({
        model: modelo,
        contents: pedido,
        config: {
          systemInstruction: INSTRUCCIONES,
          responseMimeType: "application/json",
          responseJsonSchema: ESQUEMA,
        },
      });
      const { preguntas } = JSON.parse(response.text ?? "");
      return res.status(200).json({
        modelo,
        preguntas: preguntas
          .filter((p) => Array.isArray(p.o) && p.o.length === 4 && p.a >= 0 && p.a <= 3)
          .map((p) => ({ tema: limpiar(p.tema), q: limpiar(p.q), o: p.o.map(limpiar), a: p.a })),
      });
    } catch (err) {
      console.error(`[IA] ${modelo} falló:`, err.message.slice(0, 200));
    }
  }
  res.status(502).json({ error: "La IA no respondió" });
}
