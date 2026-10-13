// Red del juego sin servidor propio: la pantalla principal es el "servidor" y los teléfonos
// se conectan a ella por WebRTC usando PeerJS. Funciona igual en Live Server y en Vercel.
//
// Mensajes: { e: "evento", d: datos, id? }. Si un mensaje lleva id, la respuesta vuelve con { e: "respuesta", id, d }.

const PREFIJO = "duelo-sistemas-v1-";
const TIEMPO_PREGUNTA = 15; // segundos
const TIEMPO_REVELAR = 5000; // ms
const VIDAS = 3;

function mezclar(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function codigoAleatorio() {
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin O/0/I/1 para que no se confundan
  return Array.from({ length: 4 }, () => L[Math.floor(Math.random() * L.length)]).join("");
}

function emisor() {
  const handlers = {};
  return {
    on: (e, f) => (handlers[e] ??= []).push(f),
    disparar: (e, d) => (handlers[e] || []).forEach((f) => f(d)),
  };
}

// ---------------------------------------------------------------------------
// Pantalla principal: crea la sala y ejecuta todas las reglas del duelo.
// ---------------------------------------------------------------------------
window.crearSalaHost = function () {
  const bus = emisor();
  const sala = {
    codigo: null,
    jugadores: [null, null], // { token, nombre, vidas, conectado, conn }
    estado: "lobby", // lobby | cuenta | pregunta | revelar | fin
    colaIA: [], // preguntas de Gemini: siempre tienen prioridad
    banco: mezclar(window.BANCO), // respaldo si la IA no está disponible
    usadas: [],
    temas: [], // temas de las preguntas ya hechas, para no repetir seguidos
    actual: null,
    respuestas: [null, null], // { opcion, ms }
    inicio: 0,
    timer: null,
    ronda: 0,
    estadoIA: null, // null | "activa" | "sin-api" | "error"
    peticionIA: null,
  };
  const conexiones = new Set();
  let peer;

  // Envía a la pantalla y a todos los teléfonos.
  function difundir(e, d) {
    bus.disparar(e, d);
    for (const c of conexiones) if (c.open) c.send({ e, d });
  }
  const enviar = (conn, e, d) => conn.open && conn.send({ e, d });

  function publico() {
    return {
      codigo: sala.codigo,
      estado: sala.estado,
      ronda: sala.ronda,
      jugadores: sala.jugadores.map((j) => j && { nombre: j.nombre, vidas: j.vidas, conectado: j.conectado }),
    };
  }
  const emitirSala = () => difundir("sala", publico());

  function estadoIA(estado) {
    if (sala.estadoIA === estado) return;
    sala.estadoIA = estado;
    bus.disparar("ia", estado);
  }

  // Preguntas de Gemini vía la función /api/preguntas (solo existe en Vercel o con "npm run dev").
  function rellenarConIA() {
    if (sala.peticionIA || sala.estadoIA === "sin-api") return sala.peticionIA;
    sala.peticionIA = (async () => {
      try {
        const r = await fetch("api/preguntas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cantidad: 10,
            evitar: [...sala.usadas, ...sala.colaIA.map((p) => p.q)],
            temasRecientes: [...sala.temas.slice(-2), ...sala.colaIA.slice(-1).map((p) => p.tema)],
          }),
        });
        // 404/405: la página está en un servidor sin funciones (Live Server). No se vuelve a intentar.
        if (r.status === 404 || r.status === 405) return estadoIA("sin-api");
        const { preguntas } = r.ok ? await r.json() : {};
        if (!preguntas?.length) return estadoIA("error");
        sala.colaIA.push(...preguntas.filter((p) => !sala.usadas.includes(p.q)).map((p) => ({ ...p, ia: true })));
        estadoIA("activa");
      } catch {
        estadoIA("error");
      } finally {
        sala.peticionIA = null;
      }
    })();
    return sala.peticionIA;
  }

  // Saca de la cola la primera pregunta cuyo tema no sea el de la pregunta anterior.
  function sacarDe(cola) {
    const anterior = sala.temas.at(-1);
    const i = cola.findIndex((p) => !p.tema || p.tema !== anterior);
    return cola.splice(i === -1 ? 0 : i, 1)[0];
  }

  async function elegirPregunta() {
    // Si la IA está trabajando y no hay preguntas suyas, se le dan unos segundos antes de usar el banco.
    if (!sala.colaIA.length && sala.peticionIA) await Promise.race([sala.peticionIA, new Promise((r) => setTimeout(r, 6000))]);
    if (sala.colaIA.length < 5) rellenarConIA();
    if (sala.colaIA.length) return sacarDe(sala.colaIA);
    if (!sala.banco.length) sala.banco = mezclar(window.BANCO.filter((p) => !sala.usadas.includes(p.q)));
    if (!sala.banco.length) sala.banco = mezclar(window.BANCO);
    return sacarDe(sala.banco);
  }

  function datosPregunta(extra = {}) {
    const restante = Math.max(1, Math.round(TIEMPO_PREGUNTA - (Date.now() - sala.inicio) / 1000));
    const { q, o, ia, tema } = sala.actual;
    return { ronda: sala.ronda, q, o, ia, tema, tiempo: restante, ...extra };
  }

  async function siguientePregunta() {
    clearTimeout(sala.timer);
    const p = await elegirPregunta();
    if (sala.estado !== "cuenta" && sala.estado !== "revelar") return; // la partida cambió mientras se esperaba
    // Se mezclan las opciones para que la correcta no quede siempre en el mismo lugar.
    const orden = mezclar([0, 1, 2, 3]);
    sala.actual = { q: p.q, o: orden.map((i) => p.o[i]), a: orden.indexOf(p.a), ia: !!p.ia, tema: p.tema };
    sala.usadas.push(p.q);
    sala.temas.push(p.tema);
    sala.respuestas = [null, null];
    sala.estado = "pregunta";
    sala.ronda++;
    sala.inicio = Date.now();
    emitirSala();
    difundir("pregunta", datosPregunta({ tiempo: TIEMPO_PREGUNTA }));
    sala.timer = setTimeout(resolver, TIEMPO_PREGUNTA * 1000);
  }

  function resolver() {
    if (sala.estado !== "pregunta") return;
    clearTimeout(sala.timer);
    sala.estado = "revelar";
    const [r0, r1] = sala.respuestas;
    const ok0 = r0?.opcion === sala.actual.a;
    const ok1 = r1?.opcion === sala.actual.a;

    // Reglas: solo hay disparo cuando uno acierta y el otro no (no responder cuenta como fallar).
    let resultado, perdedor = null;
    if (ok0 && ok1) resultado = "empate";
    else if (ok0) { resultado = "disparo"; perdedor = 1; }
    else if (ok1) { resultado = "disparo"; perdedor = 0; }
    else resultado = "nadie";

    if (perdedor !== null) sala.jugadores[perdedor].vidas--;

    difundir("resultado", {
      correcta: sala.actual.a,
      respuestas: sala.respuestas.map((r) => (r ? r.opcion : null)),
      resultado,
      perdedor,
    });

    const muerto = sala.jugadores.findIndex((j) => j.vidas <= 0);
    if (muerto !== -1) {
      sala.estado = "fin";
      emitirSala();
      setTimeout(() => difundir("fin", { ganador: 1 - muerto }), 2500);
      return;
    }
    emitirSala();
    sala.timer = setTimeout(siguientePregunta, TIEMPO_REVELAR);
  }

  function iniciar() {
    sala.jugadores.forEach((j) => (j.vidas = VIDAS));
    sala.ronda = 0;
    sala.estado = "cuenta";
    difundir("cuenta", { segundos: 3 });
    emitirSala();
    sala.timer = setTimeout(siguientePregunta, 3500);
  }

  // ---- Mensajes de los teléfonos ----
  const acciones = {
    unirse(conn, { nombre, token }) {
      let slot = sala.jugadores.findIndex((j) => j && j.token === token); // reconexión
      if (slot === -1) {
        slot = sala.jugadores.findIndex((j) => j === null);
        if (slot === -1) return { error: "La sala ya tiene dos vaqueros" };
        sala.jugadores[slot] = { token, nombre: String(nombre || `Vaquero ${slot + 1}`).slice(0, 14), vidas: VIDAS };
      }
      const j = sala.jugadores[slot];
      j.conn = conn;
      j.conectado = true;
      conn.slot = slot;
      setTimeout(() => {
        emitirSala();
        if (sala.estado === "pregunta") enviar(conn, "pregunta", datosPregunta({ yaRespondio: sala.respuestas[slot] !== null }));
        if (sala.estado === "lobby" && sala.jugadores.every((x) => x?.conectado)) iniciar();
      });
      return { ok: true, slot, nombre: j.nombre };
    },
    responder(conn, { opcion }) {
      const slot = conn.slot;
      if (slot === undefined || sala.estado !== "pregunta") return;
      if (sala.respuestas[slot] !== null || ![0, 1, 2, 3].includes(opcion)) return;
      sala.respuestas[slot] = { opcion, ms: Date.now() - sala.inicio };
      difundir("respondio", { slot });
      if (sala.respuestas.every((r) => r !== null)) resolver();
    },
    revancha() {
      if (sala.estado === "fin" && sala.jugadores.every((x) => x?.conectado)) iniciar();
    },
  };

  function alDesconectar(conn) {
    conexiones.delete(conn);
    const j = sala.jugadores[conn.slot];
    if (!j || j.conn !== conn) return;
    j.conectado = false;
    // En el lobby se libera el lugar; en partida se guarda para que pueda reconectar.
    if (sala.estado === "lobby") sala.jugadores[conn.slot] = null;
    emitirSala();
  }

  function abrir() {
    sala.codigo = codigoAleatorio();
    peer = new Peer(PREFIJO + sala.codigo);
    peer.on("open", () => {
      bus.disparar("creada", { codigo: sala.codigo });
      emitirSala();
      rellenarConIA();
    });
    peer.on("connection", (conn) => {
      conexiones.add(conn);
      conn.on("data", (m) => {
        const r = acciones[m?.e]?.(conn, m.d || {});
        if (m?.id !== undefined && conn.open) conn.send({ e: "respuesta", id: m.id, d: r ?? {} });
      });
      conn.on("close", () => alDesconectar(conn));
      conn.on("error", () => alDesconectar(conn));
    });
    peer.on("disconnected", () => peer.reconnect());
    peer.on("error", (err) => {
      if (err.type === "unavailable-id") { peer.destroy(); abrir(); return; } // código ocupado: otro
      bus.disparar("error", { mensaje: "No se pudo abrir la sala (" + err.type + "). Revisa tu conexión a internet." });
    });
  }

  window.addEventListener("beforeunload", () => difundir("cerrada", {}));
  abrir();
  return { on: bus.on };
};

// ---------------------------------------------------------------------------
// Teléfono: se conecta a la sala con el código y expone on/emit como un socket.
// ---------------------------------------------------------------------------
window.conectarJugador = function () {
  const bus = emisor();
  const pendientes = new Map();
  let peer, conn, codigo, siguienteId = 0;

  function asegurarPeer() {
    if (peer && !peer.destroyed) return Promise.resolve(peer);
    return new Promise((ok, mal) => {
      peer = new Peer();
      peer.on("open", () => ok(peer));
      peer.on("disconnected", () => peer.reconnect());
      peer.on("error", (err) => {
        if (err.type === "peer-unavailable") bus.disparar("conexion:error", "No existe una sala con ese código");
        else bus.disparar("conexion:error", "Problema de conexión (" + err.type + ")");
        mal(err);
      });
    });
  }

  async function conectar(nuevoCodigo) {
    codigo = nuevoCodigo;
    await asegurarPeer();
    return new Promise((ok) => {
      conn?.close();
      conn = peer.connect(PREFIJO + codigo, { reliable: true });
      conn.on("open", () => ok());
      conn.on("data", (m) => {
        if (m?.e === "respuesta") { pendientes.get(m.id)?.(m.d); pendientes.delete(m.id); }
        else bus.disparar(m.e, m.d);
      });
      conn.on("close", () => bus.disparar("conexion:perdida"));
    });
  }

  function emit(e, d, cb) {
    if (!conn?.open) return;
    const msg = { e, d };
    if (cb) { msg.id = siguienteId++; pendientes.set(msg.id, cb); }
    conn.send(msg);
  }

  return { on: bus.on, emit, conectar, get conectado() { return !!conn?.open; } };
};
