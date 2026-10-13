# 🤠 Duelo de Sistemas

Duelo de vaqueros de trivia de sistemas. La pantalla principal (PC/TV) muestra el duelo; dos jugadores usan su teléfono como control escaneando un QR.

No necesita un servidor propio: la pantalla principal ejecuta el juego y los teléfonos se conectan a ella por WebRTC ([PeerJS](https://peerjs.com/)). Por eso funciona como sitio estático en Vercel o con Live Server.

## Estructura

| Archivo | Qué hace |
|---|---|
| `public/index.html` | Pantalla de inicio |
| `public/host.html` | Pantalla principal: vaqueros, QR y preguntas |
| `public/play.html` | Control del teléfono |
| `public/red.js` | Reglas del duelo y conexión entre pantalla y teléfonos |
| `public/banco.js` | Banco local de preguntas |
| `api/preguntas.js` | Función de Vercel que pide preguntas a Gemini |
| `dev.js` | Servidor opcional para probar la IA en tu PC (`npm run dev`) |

## Publicar en Vercel

1. Sube el repositorio a GitHub e impórtalo en Vercel (Framework Preset: **Other**).
2. En **Settings → Environment Variables** agrega `GEMINI_API_KEY` con tu key de https://aistudio.google.com/apikey
3. Despliega. El QR usará automáticamente la dirección de Vercel.

## Probar en tu PC

- **Live Server:** clic derecho en `public/index.html` → *Open with Live Server*. Usa el banco local (la IA solo está en Vercel o con `npm run dev`).
- **Con IA:** pon `GEMINI_API_KEY=...` en un archivo `.env` y ejecuta `npm install` y `npm run dev`.

El QR se arma solo con la IP de tu PC en la red: Live Server abre la página con esa IP (`liveServer.settings.useLocalIp` en `.vscode/settings.json`) y `npm run dev` la detecta. El teléfono debe estar en el mismo Wi-Fi.

## Reglas

- Cada vaquero tiene 3 vidas y 15 s por pregunta.
- Uno acierta y el otro no (o no responde) → el que acertó dispara y el otro pierde una vida.
- Ambos aciertan → empate, nadie pierde.
- Ninguno acierta o se acaba el tiempo → siguiente pregunta.
- Quien llega a 0 vidas pierde. Cualquiera puede pedir revancha desde su teléfono.

## Variables de entorno

| Variable | Uso |
|---|---|
| `GEMINI_API_KEY` | Activa las preguntas generadas con IA |
| `GEMINI_MODEL` | Modelo principal de Gemini (por defecto `gemini-3.8-flash`). Si está saturado se prueban otros Flash (ver `api/preguntas.js`) |

## Preguntas

La IA tiene prioridad: al crear la sala se pide un lote de 10 preguntas y se piden más antes de que se acaben. Cada lote rota entre 15 temas (programación, bases de datos, redes, ciberseguridad, IA, blockchain, cloud, Linux, etc.), sin repetir tema seguido y evitando preguntas ya hechas. El banco local (`public/banco.js`) solo se usa si la IA no está disponible.
