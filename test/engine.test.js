// Pruebas del motor de Brotes. Ejecutar con: node test/engine.test.js
const assert = require("assert");
const B = require("../js/engine.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.stack); process.exitCode = 1; }
}

// Prepara una partida con cartas y agua conocidas.
function setup(n, hands, opts) {
  let s = B.newGame(Array.from({ length: n }, (_, i) => "J" + i), { seed: 42 });
  hands.forEach((h, i) => { s.players[i].cards = h.map((role) => ({ role, lost: false })); });
  s.turn = 0;
  Object.assign(s, opts || {});
  return s;
}
const go = (s, m) => B.dispatch(s, m);
// Cartas en juego: mazo + manos + las robadas por el Girasol mientras elige.
const totalCards = (s) => s.deck.length + s.players.reduce((a, p) => a + p.cards.length, 0) +
  (s.phase === "exchange" ? s.pending.exchange.options.length - s.pending.exchange.keep : 0);

console.log("Escenarios:");

test("Refrescarse da 1 gota y pasa el turno", () => {
  let s = setup(3, [["cactus", "girasol"], ["tronco", "tronco"], ["girasol", "girasol"]]);
  s = go(s, { type: "action", player: 0, action: "refrescar" });
  assert.strictEqual(s.players[0].water, 3);
  assert.strictEqual(s.turn, 1);
});

test("Pedir ayuda se puede bloquear con Planta Carnívora", () => {
  let s = setup(3, [["cactus", "girasol"], ["carnivora", "tronco"], ["girasol", "girasol"]]);
  s = go(s, { type: "action", player: 0, action: "ayuda" });
  assert.strictEqual(s.phase, "block");
  assert.deepStrictEqual(s.pending.blockers, [1, 2]);
  s = go(s, { type: "block", player: 1, role: "carnivora" });
  assert.strictEqual(s.phase, "challenge");
  s = go(s, { type: "passAll" });
  assert.strictEqual(s.players[0].water, 2, "no gana agua");
  assert.strictEqual(s.turn, 1);
});

test("Desafío a un mentiroso: pierde carta y la acción falla", () => {
  let s = setup(3, [["cactus", "girasol"], ["tronco", "tronco"], ["girasol", "girasol"]]);
  s = go(s, { type: "action", player: 0, action: "carnivora" });
  s = go(s, { type: "challenge", player: 1 });
  assert.strictEqual(s.phase, "lose");
  s = go(s, { type: "lose", player: 0, index: 0 });
  assert.strictEqual(s.players[0].water, 2);
  assert.strictEqual(B.liveCards(s.players[0]).length, 1);
  assert.strictEqual(s.turn, 1);
});

test("Desafío a quien dice la verdad: el desafiante pierde y la acción sigue", () => {
  let s = setup(3, [["carnivora", "girasol"], ["tronco", "cactus"], ["girasol", "girasol"]]);
  const before = totalCards(s);
  s = go(s, { type: "action", player: 0, action: "carnivora" });
  s = go(s, { type: "challenge", player: 1 });
  s = go(s, { type: "lose", player: 1, index: 1 });
  assert.strictEqual(s.players[0].water, 5);
  assert.strictEqual(totalCards(s), before, "la carta mostrada vuelve al mazo y se roba otra");
});

test("Cactus: paga 3, la víctima pierde una planta; si mentía se devuelve el agua", () => {
  let s = setup(3, [["cactus", "girasol"], ["tronco", "tronco"], ["girasol", "girasol"]]);
  s.players[0].water = 5;
  s = go(s, { type: "action", player: 0, action: "cactus", target: 1 });
  assert.strictEqual(s.players[0].water, 2);
  s = go(s, { type: "passAll" });            // nadie desafía
  assert.strictEqual(s.phase, "block");
  s = go(s, { type: "pass", player: 1 });     // no bloquea
  s = go(s, { type: "lose", player: 1, index: 0 });
  assert.strictEqual(B.liveCards(s.players[1]).length, 1);

  let t = setup(3, [["girasol", "girasol"], ["tronco", "tronco"], ["girasol", "girasol"]]);
  t.players[0].water = 5;
  t = go(t, { type: "action", player: 0, action: "cactus", target: 1 });
  t = go(t, { type: "challenge", player: 2 });
  t = go(t, { type: "lose", player: 0, index: 0 });
  assert.strictEqual(t.players[0].water, 5, "se devuelve el coste");
});

test("Enredadera bloquea al Cactus; un bloqueo falso se castiga y el Cactus sigue", () => {
  let s = setup(3, [["cactus", "girasol"], ["tronco", "tronco"], ["girasol", "girasol"]]);
  s.players[0].water = 5;
  s = go(s, { type: "action", player: 0, action: "cactus", target: 1 });
  s = go(s, { type: "passAll" });
  s = go(s, { type: "block", player: 1, role: "enredadera" });
  s = go(s, { type: "challenge", player: 0 });
  // J1 mintió: pierde 1 por mentir y luego 1 por el Cactus = eliminado
  s = go(s, { type: "lose", player: 1, index: 0 });
  assert.strictEqual(s.players[1].status, "abono");
});

test("Defensa inmediata: el atacado bloquea al Cactus con Enredadera sin esperar a los desafíos", () => {
  let s = setup(4, [["cactus", "girasol"], ["enredadera", "tronco"], ["girasol", "girasol"], ["tronco", "tronco"]]);
  s.players[0].water = 5;
  s = go(s, { type: "action", player: 0, action: "cactus", target: 1 });
  assert.strictEqual(s.phase, "challenge");
  assert.deepStrictEqual(B.blockOptions(s, 1), ["enredadera"], "el atacado puede bloquear ya");
  assert.deepStrictEqual(B.blockOptions(s, 2), [], "los demás no bloquean al Cactus");
  assert.throws(() => go(s, { type: "block", player: 2, role: "enredadera" }));
  s = go(s, { type: "block", player: 1, role: "enredadera" });
  assert.strictEqual(s.phase, "challenge");
  assert.strictEqual(s.pending.claim.kind, "block");
  s = go(s, { type: "passAll" });
  assert.strictEqual(B.liveCards(s.players[1]).length, 2, "el bloqueo lo salvó");
  assert.strictEqual(s.players[0].water, 2, "el Cactus pagó igual");
  assert.strictEqual(s.turn, 1);
});

test("Defensa inmediata también tras decir 'no desafío', y con Tronco/Girasol y contra la Enredadera", () => {
  let s = setup(3, [["tronco", "enredadera"], ["girasol", "cactus"], ["tronco", "carnivora"]]);
  s.players[1].water = 4;
  s = go(s, { type: "action", player: 0, action: "tronco", target: 1 });
  s = go(s, { type: "pass", player: 1 });               // el atacado no desafía…
  assert.deepStrictEqual(B.blockOptions(s, 1), ["tronco", "girasol"], "…pero aún puede bloquear");
  s = go(s, { type: "block", player: 1, role: "girasol" });
  s = go(s, { type: "passAll" });
  assert.strictEqual(s.players[1].water, 4, "no le robaron");

  let t = setup(3, [["enredadera", "girasol"], ["tronco", "cactus"], ["girasol", "girasol"]]);
  t = go(t, { type: "action", player: 0, action: "enredadera", target: 1 });
  assert.deepStrictEqual(B.blockOptions(t, 1), ["tronco"]);
  t = go(t, { type: "block", player: 1, role: "tronco" });
  t = go(t, { type: "passAll" });
  assert.strictEqual(t.vines[0], undefined, "no se enganchó");
});

test("Pedir ayuda: cualquiera puede bloquearla con Carnívora", () => {
  let s = setup(3, [["cactus", "girasol"], ["tronco", "tronco"], ["carnivora", "girasol"]]);
  s = go(s, { type: "action", player: 0, action: "ayuda" });
  assert.strictEqual(s.phase, "block");
  assert.deepStrictEqual(B.blockOptions(s, 2), ["carnivora"]);
  assert.deepStrictEqual(B.blockOptions(s, 0), [], "no te bloqueas a ti mismo");
  s = go(s, { type: "block", player: 2, role: "carnivora" });
  s = go(s, { type: "passAll" });
  assert.strictEqual(s.players[0].water, 2);
});

test("Tronco roba 2 gotas; Girasol y Tronco lo bloquean", () => {
  let s = setup(3, [["tronco", "girasol"], ["cactus", "cactus"], ["girasol", "girasol"]]);
  s.players[1].water = 5;
  s = go(s, { type: "action", player: 0, action: "tronco", target: 1 });
  s = go(s, { type: "passAll" });
  s = go(s, { type: "pass", player: 1 });
  assert.strictEqual(s.players[0].water, 4);
  assert.strictEqual(s.players[1].water, 3);
  let t = setup(3, [["tronco", "girasol"], ["girasol", "cactus"], ["girasol", "girasol"]]);
  t = go(t, { type: "action", player: 0, action: "tronco", target: 1 });
  t = go(t, { type: "passAll" });
  assert.throws(() => go(t, { type: "block", player: 1, role: "cactus" }));
  t = go(t, { type: "block", player: 1, role: "girasol" });
  t = go(t, { type: "passAll" });
  assert.strictEqual(t.players[0].water, 2);
});

test("Enredadera absorbe 1 gota cada vez que la víctima recibe agua", () => {
  let s = setup(3, [["enredadera", "girasol"], ["cactus", "cactus"], ["girasol", "girasol"]]);
  s = go(s, { type: "action", player: 0, action: "enredadera", target: 1 });
  s = go(s, { type: "passAll" });
  s = go(s, { type: "pass", player: 1 });
  assert.strictEqual(s.vines[0], 1);
  s = go(s, { type: "action", player: 1, action: "ayuda" });
  s = go(s, { type: "passAll" });
  assert.strictEqual(s.players[1].water, 3, "2 + 2 - 1");
  assert.strictEqual(s.players[0].water, 3, "2 + 1");
});

test("El Tronco bloquea el enganche y permite soltarse (aunque sea un farol)", () => {
  let s = setup(3, [["enredadera", "girasol"], ["tronco", "cactus"], ["girasol", "girasol"]]);
  s = go(s, { type: "action", player: 0, action: "enredadera", target: 1 });
  s = go(s, { type: "passAll" });
  s = go(s, { type: "block", player: 1, role: "tronco" });
  s = go(s, { type: "passAll" });
  assert.strictEqual(s.vines[0], undefined);

  let t = setup(3, [["enredadera", "girasol"], ["cactus", "cactus"], ["girasol", "girasol"]]);
  t = go(t, { type: "action", player: 0, action: "enredadera", target: 1 });
  t = go(t, { type: "passAll" }); t = go(t, { type: "pass", player: 1 });
  assert.ok(B.availableActions(t, 1).some((a) => a.key === "soltarse" && a.bluff));
  t = go(t, { type: "action", player: 1, action: "soltarse" });
  t = go(t, { type: "passAll" });
  assert.strictEqual(t.vines[0], undefined);
});

test("La Enredadera se suelta cuando su dueño pierde una carta", () => {
  let s = setup(3, [["enredadera", "girasol"], ["cactus", "carnivora"], ["girasol", "girasol"]]);
  s.vines = { 0: 1 };
  s.turn = 1;
  s.players[1].water = 3;
  s = go(s, { type: "action", player: 1, action: "cactus", target: 0 });
  s = go(s, { type: "passAll" });
  s = go(s, { type: "pass", player: 0 });
  s = go(s, { type: "lose", player: 0, index: 1 });
  assert.strictEqual(s.vines[0], undefined);
});

test("Con 11 gotas solo se puede Exterminar, y cuesta 8", () => {
  let s = setup(3, [["cactus", "girasol"], ["tronco", "tronco"], ["girasol", "girasol"]]);
  s.players[0].water = 11;
  assert.throws(() => go(s, { type: "action", player: 0, action: "refrescar" }), /obligatorio/);
  s = go(s, { type: "action", player: 0, action: "exterminar", target: 2 });
  assert.strictEqual(s.players[0].water, 3);
  assert.strictEqual(s.phase, "lose");
});

test("Girasol cambia cartas con 2 del mazo", () => {
  let s = setup(3, [["girasol", "cactus"], ["tronco", "tronco"], ["girasol", "girasol"]]);
  const before = totalCards(s);
  s = go(s, { type: "action", player: 0, action: "girasol" });
  s = go(s, { type: "passAll" });
  assert.strictEqual(s.phase, "exchange");
  assert.strictEqual(s.pending.exchange.options.length, 4);
  const want = [2, 3];
  const roles = want.map((i) => s.pending.exchange.options[i]);
  s = go(s, { type: "exchange", player: 0, keep: want });
  assert.deepStrictEqual(s.players[0].cards.map((c) => c.role), roles);
  assert.strictEqual(totalCards(s), before);
});

test("Abono: gana 1 gota por turno y revive con 6 (una sola vez)", () => {
  let s = setup(4, [["cactus", "girasol"], ["tronco", "tronco"], ["girasol", "girasol"], ["cactus", "cactus"]]);
  s.players[3].status = "abono";
  s.players[3].cards.forEach((c) => (c.lost = true));
  s.players[3].abonoGotas = 5;
  s.turn = 2;
  s = go(s, { type: "action", player: 2, action: "refrescar" });
  assert.strictEqual(s.players[3].status, "alive");
  assert.strictEqual(s.turn, 3, "juega en cuanto revive");
  assert.strictEqual(B.liveCards(s.players[3]).length, 1);
  assert.strictEqual(s.players[3].water, 2);
  assert.ok(s.players[3].revived);
});

test("No se revive si solo quedan 2 vivos", () => {
  let s = setup(3, [["cactus", "girasol"], ["tronco", "tronco"], ["girasol", "girasol"]]);
  s.players[2].status = "abono";
  s.players[2].cards.forEach((c) => (c.lost = true));
  s.players[2].abonoGotas = 5;
  s.turn = 1;
  s = go(s, { type: "action", player: 1, action: "refrescar" });
  assert.strictEqual(s.players[2].status, "abono");
  assert.strictEqual(s.turn, 0);
});

test("Gana el último con plantas", () => {
  let s = setup(2, [["cactus", "girasol"], ["tronco", "tronco"]]);
  s.players[1].cards[0].lost = true;
  s.players[0].water = 8;
  s = go(s, { type: "action", player: 0, action: "exterminar", target: 1 });
  assert.strictEqual(s.phase, "over");
  assert.strictEqual(s.winner, 0);
});

test("viewFor oculta las cartas de los demás", () => {
  const s = setup(3, [["cactus", "girasol"], ["tronco", "tronco"], ["girasol", "girasol"]]);
  const v = B.viewFor(s, 0);
  assert.strictEqual(v.players[0].cards[0].role, "cactus");
  assert.strictEqual(v.players[1].cards[0].role, null);
  assert.strictEqual(v.deck.length, 0);
});

// ---------- partidas aleatorias ----------
console.log("Partidas aleatorias:");

function randomMove(s, r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const w = B.waitingFor(s);
  switch (s.phase) {
    case "action": {
      const p = s.turn;
      const acts = B.availableActions(s, p).filter((a) => a.ok);
      const a = pick(acts);
      const m = { type: "action", player: p, action: a.key };
      if (a.target) m.target = pick(s.players.filter((q) => q.status === "alive" && q.id !== p)).id;
      return m;
    }
    case "challenge": {
      // A veces el atacado se defiende bloqueando sin esperar.
      const defenders = s.players.filter((p) => B.blockOptions(s, p.id).length);
      if (defenders.length && r() < 0.2) {
        const d = pick(defenders);
        return { type: "block", player: d.id, role: pick(B.blockOptions(s, d.id)) };
      }
      const id = pick(w);
      return r() < 0.25 ? { type: "challenge", player: id } : { type: "pass", player: id };
    }
    case "block": {
      const id = pick(w);
      if (r() < 0.3) return { type: "block", player: id, role: pick(B.ACTIONS[s.pending.action].blockedBy) };
      return { type: "pass", player: id };
    }
    case "lose": {
      const p = s.players[s.pending.loss.player];
      const idx = p.cards.map((c, i) => (c.lost ? -1 : i)).filter((i) => i >= 0);
      return { type: "lose", player: p.id, index: pick(idx) };
    }
    case "exchange": {
      const ex = s.pending.exchange;
      const idx = ex.options.map((_, i) => i).sort(() => r() - 0.5).slice(0, ex.keep);
      return { type: "exchange", player: s.pending.actor, keep: idx };
    }
  }
  throw new Error("fase inesperada " + s.phase);
}

test("3000 partidas aleatorias de 2 a 10 jugadores terminan sin romper reglas", () => {
  let seed = 1, games = 0, steps = 0, revives = 0;
  const r = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let g = 0; g < 3000; g++) {
    const n = 2 + (g % 9);
    let s = B.newGame(Array.from({ length: n }, (_, i) => "P" + i), { seed: g });
    let k = 0;
    while (s.phase !== "over") {
      s = B.dispatch(s, randomMove(s, r));
      k++;
      assert.ok(k < 5000, "la partida no termina");
      assert.strictEqual(totalCards(s), 25, "se pierden o duplican cartas");
      for (const p of s.players) {
        assert.ok(p.water >= 0, "agua negativa");
        const live = B.liveCards(p).length;
        if (p.status === "alive") assert.ok(live >= 1 && live <= 2);
        else assert.strictEqual(live, 0);
      }
      for (const [o, v] of Object.entries(s.vines)) {
        assert.strictEqual(s.players[o].status, "alive");
        assert.strictEqual(s.players[v].status, "alive");
      }
    }
    revives += s.players.filter((p) => p.revived).length;
    games++; steps += k;
    assert.strictEqual(s.players.filter((p) => p.status === "alive").length, 1);
  }
  console.log("    " + games + " partidas, " + steps + " jugadas, " + revives + " jugadores revividos");
});

console.log("\n" + passed + " pruebas correctas" + (process.exitCode ? " (con fallos)" : ""));
