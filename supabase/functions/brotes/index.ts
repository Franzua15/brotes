// Brotes — servidor del modo online (Supabase Edge Function).
// Guarda la partida completa en la tabla `rooms`, a la que solo accede este servidor,
// y a cada jugador le devuelve solo lo que puede ver (sus propias cartas).
import "./engine.js";

// deno-lint-ignore no-explicit-any
const B = (globalThis as any).Brotes;
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_PLAYERS = 10;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class GameError extends Error {}
const fail = (msg: string): never => { throw new GameError(msg); };

// deno-lint-ignore no-explicit-any
type Room = { code: string; status: string; players: { name: string; token: string }[]; state: any; version: number };

async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error("Base de datos: " + (body?.message || res.status));
  return body;
}

async function getRoom(code: string): Promise<Room> {
  const rows = await rest(`rooms?code=eq.${encodeURIComponent(code)}&select=*`);
  if (!rows.length) fail("No existe ninguna sala con ese código.");
  return rows[0];
}

// Guarda solo si nadie la cambió mientras tanto (control de versión).
async function saveRoom(room: Room, patch: Partial<Room>): Promise<Room | null> {
  const rows = await rest(`rooms?code=eq.${encodeURIComponent(room.code)}&version=eq.${room.version}`, {
    method: "PATCH",
    body: JSON.stringify({ ...patch, version: room.version + 1, updated_at: new Date().toISOString() }),
  });
  return rows.length ? rows[0] : null;
}

// Avisa en tiempo real a todos los de la sala de que hay cambios.
async function notify(code: string, version: number) {
  try {
    await fetch(`${SB_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ topic: "brotes-" + code, event: "update", payload: { v: version } }] }),
    });
  } catch (_) { /* los clientes también consultan cada cierto tiempo */ }
}

function seatOf(room: Room, token: string): number {
  const i = room.players.findIndex((p) => p.token === token);
  if (i < 0) fail("No formas parte de esta sala.");
  return i;
}

function cleanName(n: unknown): string {
  const s = String(n || "").replace(/\s+/g, " ").trim().slice(0, 14);
  if (!s) fail("Escribe tu nombre.");
  return s;
}

function newCode(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 5; i++) c += abc[Math.floor(Math.random() * abc.length)];
  return c;
}

function publicView(room: Room, seat: number) {
  return {
    room: { code: room.code, status: room.status, players: room.players.map((p) => p.name), host: 0, version: room.version },
    seat,
    state: room.state ? { ...B.viewFor(room.state, seat), now: Date.now() } : null,
  };
}

// deno-lint-ignore no-explicit-any
async function handle(body: any) {
  const op = body.op;
  const code = String(body.code || "").toUpperCase().trim();
  const token = String(body.token || "");

  if (op === "create") {
    const name = cleanName(body.name);
    const tok = crypto.randomUUID();
    for (let tries = 0; tries < 5; tries++) {
      const c = newCode();
      try {
        const rows = await rest("rooms", { method: "POST", body: JSON.stringify({ code: c, status: "lobby", players: [{ name, token: tok }], version: 1 }) });
        return { token: tok, ...publicView(rows[0], 0) };
      } catch (_) { /* código repetido: probar otro */ }
    }
    fail("No se pudo crear la sala. Inténtalo de nuevo.");
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    const room = await getRoom(code);

    if (op === "view") return publicView(room, seatOf(room, token));

    if (op === "join") {
      const existing = room.players.findIndex((p) => p.token === token);
      if (existing >= 0) return { token, ...publicView(room, existing) };
      if (room.status !== "lobby") fail("Esta partida ya empezó.");
      if (room.players.length >= MAX_PLAYERS) fail("La sala está llena (máximo " + MAX_PLAYERS + ").");
      let name = cleanName(body.name);
      const taken = new Set(room.players.map((p) => p.name.toLowerCase()));
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = cleanName(body.name).slice(0, 12) + " " + n;
      const tok = crypto.randomUUID();
      const saved = await saveRoom(room, { players: [...room.players, { name, token: tok }] });
      if (!saved) continue;
      await notify(code, saved.version);
      return { token: tok, ...publicView(saved, saved.players.length - 1) };
    }

    if (op === "leave") {
      const seat = seatOf(room, token);
      if (room.status !== "lobby") fail("No se puede salir de una partida empezada.");
      if (seat === 0) fail("El creador de la sala no puede salir.");
      const saved = await saveRoom(room, { players: room.players.filter((_, i) => i !== seat) });
      if (!saved) continue;
      await notify(code, saved.version);
      return { ok: true };
    }

    if (op === "start") {
      const seat = seatOf(room, token);
      if (seat !== 0) fail("Solo quien creó la sala puede empezar.");
      if (room.status === "playing") fail("La partida ya empezó.");
      if (room.players.length < 2) fail("Hacen falta al menos 2 jugadores.");
      const state = B.newGame(room.players.map((p) => p.name));
      const saved = await saveRoom(room, { status: "playing", state });
      if (!saved) continue;
      await notify(code, saved.version);
      return publicView(saved, seat);
    }

    if (op === "move") {
      const seat = seatOf(room, token);
      if (room.status !== "playing" || !room.state) fail("La partida no está en curso.");
      const move = body.move || {};
      // Sin límite de tiempo: cada jugador responde cuando quiere.
      if (move.type === "passAll" || move.type === "timeout") fail("Jugada no permitida.");
      let next;
      try {
        next = B.dispatch(room.state, { ...move, player: seat });
      } catch (e) {
        fail((e as Error).message);
      }
      const saved = await saveRoom(room, { state: next, status: next.phase === "over" ? "over" : "playing" });
      if (!saved) continue;
      await notify(code, saved.version);
      return publicView(saved, seat);
    }

    fail("Operación desconocida.");
  }
  fail("Mucha gente jugando a la vez. Inténtalo otra vez.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    const out = await handle(body);
    return new Response(JSON.stringify(out), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    const known = e instanceof GameError;
    if (!known) console.error(e);
    return new Response(JSON.stringify({ error: known ? e.message : "Error del servidor. Inténtalo otra vez." }), {
      status: known ? 400 : 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
