// Servidor solo para desarrollo: sirve public/ y la función /api/preguntas igual que Vercel,
// para probar las preguntas de Gemini en tu PC con la key del archivo .env. Uso: npm run dev
import http from "http";
import os from "os";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import preguntas from "./api/preguntas.js";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const PORT = process.env.PORT || 3000;

// IP de la PC en la red local (descarta adaptadores virtuales y prefiere el Wi-Fi) para el QR.
function ipRed() {
  const candidatas = [];
  for (const [nombre, ifaces] of Object.entries(os.networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family !== "IPv4" || i.internal) continue;
      if (/virtual|vbox|vmware|vethernet|wsl|docker|hyper-v/i.test(nombre) || i.address.startsWith("192.168.56.")) continue;
      candidatas.push({ address: i.address, wifi: /wi-?fi|wlan|wireless/i.test(nombre) });
    }
  }
  candidatas.sort((a, b) => b.wifi - a.wifi);
  return candidatas[0]?.address ?? null;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");

    if (url.pathname === "/api/red") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ip: ipRed() }));
      return;
    }

    if (url.pathname === "/api/preguntas") {
      let body = "";
      for await (const chunk of req) body += chunk;
      req.body = body ? JSON.parse(body) : {};
      // Mínimo de la API de respuesta de Vercel que usa la función.
      res.status = (code) => ((res.statusCode = code), res);
      res.json = (data) => (res.setHeader("Content-Type", "application/json"), res.end(JSON.stringify(data)));
      return preguntas(req, res);
    }

    const archivo = path.join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname);
    if (!archivo.startsWith(PUBLIC)) return res.writeHead(403).end();
    try {
      const datos = await fs.readFile(archivo);
      res.writeHead(200, { "Content-Type": TIPOS[path.extname(archivo)] || "application/octet-stream" }).end(datos);
    } catch {
      res.writeHead(404).end("No encontrado");
    }
  })
  .listen(PORT, () => {
    console.log(`Duelo de Sistemas (desarrollo) en http://localhost:${PORT}  ·  en la red: http://${ipRed()}:${PORT}`);
    console.log(`Preguntas con IA: ${process.env.GEMINI_API_KEY ? "activadas" : "desactivadas (pon GEMINI_API_KEY en .env)"}`);
  });
