/*
 * Brotes — motor de reglas.
 * Funciones puras: dispatch(estado, jugada) devuelve un estado nuevo o lanza un Error con el motivo.
 * No toca la pantalla ni la red, así sirve igual para el modo prueba y para el modo online.
 */
(function (root) {
  "use strict";

  const ROLES = ["tronco", "girasol", "enredadera", "cactus", "carnivora"];

  const ROLE_INFO = {
    tronco:     { name: "Tronco Robusto",   emoji: "🌳" },
    girasol:    { name: "Girasol",          emoji: "🌻" },
    enredadera: { name: "Enredadera",       emoji: "🌿" },
    cactus:     { name: "Cactus",           emoji: "🌵" },
    carnivora:  { name: "Planta Carnívora", emoji: "🪴" },
  };

  const DEFAULT_CONFIG = {
    copies: 5,          // copias de cada planta (5 x 5 = 25 cartas)
    startWater: 2,      // gotas al empezar
    startCards: 2,      // cartas al empezar
    exterminarCost: 8,  // coste de Exterminar
    forceAt: 11,        // con esta agua o más es obligatorio Exterminar
    cactusCost: 3,      // coste del Cactus
    abonoRevive: 6,     // gotas de abono para revivir
    reviveWater: 2,     // gotas con las que vuelve un revivido
    minPlayers: 2,
    maxPlayers: 10,
  };

  // Acciones del turno. `role`: planta que hay que declarar. `blockedBy`: plantas que la bloquean.
  const ACTIONS = {
    refrescar:  { name: "Refrescarse",                gain: 1 },
    ayuda:      { name: "Pedir ayuda a la naturaleza", gain: 2, blockedBy: ["carnivora"], anyoneBlocks: true },
    exterminar: { name: "Exterminar",                  target: true, cost: "exterminarCost" },
    carnivora:  { name: "Robar 3 gotas del manantial", role: "carnivora", gain: 3 },
    tronco:     { name: "Robar 2 gotas",               role: "tronco", target: true, blockedBy: ["tronco", "girasol"] },
    girasol:    { name: "Cambiar cartas con el mazo",  role: "girasol" },
    cactus:     { name: "Eliminar una planta",         role: "cactus", target: true, cost: "cactusCost", blockedBy: ["enredadera"] },
    enredadera: { name: "Engancharse",                 role: "enredadera", target: true, blockedBy: ["tronco"] },
    soltarse:   { name: "Soltarse de la Enredadera",   role: "tronco" },
  };

  // ---------- utilidades ----------

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Generador aleatorio con semilla (mulberry32): las partidas se pueden repetir para pruebas.
  function rand(state) {
    let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function shuffle(state, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand(state) * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function fail(msg) { throw new Error(msg); }

  const isAlive = (p) => p.status === "alive";
  const liveCards = (p) => p.cards.filter((c) => !c.lost);
  const alivePlayers = (s) => s.players.filter(isAlive);
  const nameOf = (s, id) => s.players[id].name;
  const roleLabel = (r) => ROLE_INFO[r].emoji + " " + ROLE_INFO[r].name;

  function log(s, text) {
    s.log.push(text);
    if (s.log.length > 200) s.log.shift();
    s.lastEvent = text;
  }

  function hasRole(p, role) { return liveCards(p).some((c) => c.role === role); }

  // ---------- creación ----------

  function newGame(names, opts) {
    opts = opts || {};
    const cfg = Object.assign({}, DEFAULT_CONFIG, opts.config || {});
    if (!Array.isArray(names) || names.length < cfg.minPlayers || names.length > cfg.maxPlayers)
      fail("La partida necesita entre " + cfg.minPlayers + " y " + cfg.maxPlayers + " jugadores.");
    const s = {
      v: 1,
      cfg,
      rng: (opts.seed == null ? Math.floor(Math.random() * 4294967296) : opts.seed) >>> 0,
      players: [],
      deck: [],
      turn: 0,
      round: 1,
      phase: "action",
      pending: null,
      vines: {},          // { idDueñoEnredadera: idVíctima }
      log: [],
      lastEvent: "",
      winner: null,
    };
    for (const r of ROLES) for (let i = 0; i < cfg.copies; i++) s.deck.push(r);
    shuffle(s, s.deck);
    names.forEach((n, i) => {
      const cards = [];
      for (let k = 0; k < cfg.startCards; k++) cards.push({ role: s.deck.pop(), lost: false });
      s.players.push({
        id: i,
        name: String(n || "Jugador " + (i + 1)).slice(0, 18),
        cards,
        water: cfg.startWater,
        status: "alive",   // alive | abono | out
        abonoGotas: 0,
        revived: false,
      });
    });
    s.turn = Math.floor(rand(s) * names.length);
    log(s, "🌱 Empieza la partida. Primer turno: " + nameOf(s, s.turn) + ".");
    return s;
  }

  // ---------- agua y Enredadera ----------

  // Da agua a un jugador. Cada Enredadera enganchada a él se lleva 1 gota.
  // El agua que se lleva una Enredadera no activa otras Enredaderas (evita bucles).
  function give(s, pid, n) {
    if (n <= 0) return;
    const p = s.players[pid];
    p.water += n;
    for (const owner of Object.keys(s.vines)) {
      if (s.vines[owner] !== pid) continue;
      const o = s.players[owner];
      if (!isAlive(o) || p.water <= 0) continue;
      p.water -= 1;
      o.water += 1;
      log(s, "🌿 La Enredadera de " + o.name + " absorbe 1 gota de " + p.name + ".");
    }
  }

  function dropVinesOf(s, pid) {
    for (const owner of Object.keys(s.vines)) {
      if (Number(owner) === pid || s.vines[owner] === pid) delete s.vines[owner];
    }
  }

  // ---------- perder cartas ----------

  // Pide al jugador que pierda una planta. Si solo le queda una, se pierde sola.
  function requireLoss(s, pid, reason, next) {
    const p = s.players[pid];
    if (!isAlive(p)) return continueFlow(s, next);
    const live = p.cards.map((c, i) => (c.lost ? -1 : i)).filter((i) => i >= 0);
    if (live.length === 1) {
      loseCard(s, pid, live[0], reason);
      return continueFlow(s, next);
    }
    s.phase = "lose";
    s.pending.loss = { player: pid, reason, next };
  }

  function loseCard(s, pid, idx, reason) {
    const p = s.players[pid];
    const c = p.cards[idx];
    if (!c || c.lost) fail("Esa carta no se puede perder.");
    c.lost = true;
    log(s, "💀 " + p.name + " pierde su " + roleLabel(c.role) + (reason ? " (" + reason + ")" : "") + ".");
    // La Enredadera de este jugador se suelta si pierde una carta.
    if (s.vines[pid] != null) {
      log(s, "🌿 La Enredadera de " + p.name + " se suelta de " + nameOf(s, s.vines[pid]) + ".");
      delete s.vines[pid];
    }
    if (liveCards(p).length === 0) {
      dropVinesOf(s, pid);
      p.water = 0;
      if (p.revived) {
        p.status = "out";
        log(s, "🥀 " + p.name + " queda fuera de la partida.");
      } else {
        p.status = "abono";
        p.abonoGotas = 0;
        log(s, "🍂 " + p.name + " se convierte en Abono.");
      }
      checkWinner(s);
    }
  }

  function checkWinner(s) {
    const alive = alivePlayers(s);
    if (alive.length === 1 && s.phase !== "over") {
      s.winner = alive[0].id;
      s.phase = "over";
      s.pending = null;
      log(s, "🏆 ¡" + alive[0].name + " gana la partida!");
    }
  }

  // ---------- flujo del turno ----------

  function startClaim(s, claimant, role, kind) {
    s.phase = "challenge";
    s.pending.claim = { claimant, role, kind };
    s.pending.responders = alivePlayers(s).map((p) => p.id).filter((id) => id !== claimant);
    s.pending.passed = [];
  }

  function startBlockWindow(s) {
    const a = ACTIONS[s.pending.action];
    if (!a.blockedBy) return resolve(s);
    let blockers;
    if (a.anyoneBlocks) blockers = alivePlayers(s).map((p) => p.id).filter((id) => id !== s.pending.actor);
    else blockers = isAlive(s.players[s.pending.target]) ? [s.pending.target] : [];
    if (!blockers.length) return resolve(s);
    s.phase = "block";
    s.pending.claim = null;
    s.pending.blockers = blockers;
    s.pending.passed = [];
  }

  function continueFlow(s, next) {
    if (s.phase === "over") return;
    if (next === "block") return startBlockWindow(s);
    if (next === "resolve") return resolve(s);
    if (next === "blocked") return endTurn(s);
    if (next === "end") return endTurn(s);
    fail("Paso desconocido: " + next);
  }

  function resolve(s) {
    const pd = s.pending;
    const actor = s.players[pd.actor];
    if (!isAlive(actor)) return endTurn(s);
    const target = pd.target != null ? s.players[pd.target] : null;
    const a = ACTIONS[pd.action];
    switch (pd.action) {
      case "refrescar":
      case "ayuda":
      case "carnivora":
        log(s, "💧 " + actor.name + " gana " + a.gain + (a.gain === 1 ? " gota." : " gotas."));
        give(s, actor.id, a.gain);
        return endTurn(s);
      case "tronco": {
        if (!isAlive(target)) return endTurn(s);
        const amt = Math.min(2, target.water);
        target.water -= amt;
        log(s, "🌳 " + actor.name + " roba " + amt + (amt === 1 ? " gota" : " gotas") + " a " + target.name + ".");
        give(s, actor.id, amt);
        return endTurn(s);
      }
      case "exterminar":
      case "cactus":
        if (!isAlive(target)) return endTurn(s);
        s.phase = "resolving";
        return requireLoss(s, target.id, pd.action === "cactus" ? "Cactus de " + actor.name : "exterminada por " + actor.name, "end");
      case "girasol": {
        const keep = liveCards(actor).length;
        const drawn = [];
        for (let i = 0; i < 2 && s.deck.length; i++) drawn.push(s.deck.pop());
        s.phase = "exchange";
        pd.exchange = { options: liveCards(actor).map((c) => c.role).concat(drawn), keep };
        return;
      }
      case "enredadera":
        if (!isAlive(target)) return endTurn(s);
        s.vines[actor.id] = target.id;
        log(s, "🌿 " + actor.name + " se engancha a " + target.name + ".");
        return endTurn(s);
      case "soltarse": {
        let n = 0;
        for (const owner of Object.keys(s.vines)) if (s.vines[owner] === actor.id) { delete s.vines[owner]; n++; }
        log(s, "🌳 " + actor.name + " se suelta de " + (n === 1 ? "la Enredadera" : n + " Enredaderas") + ".");
        return endTurn(s);
      }
    }
    fail("Acción desconocida.");
  }

  function endTurn(s) {
    if (s.phase === "over") return;
    s.pending = null;
    s.phase = "action";
    const n = s.players.length;
    let i = s.turn;
    for (let guard = 0; guard < n * 3; guard++) {
      i = (i + 1) % n;
      if (i === 0) s.round++;
      const p = s.players[i];
      if (p.status === "out") continue;
      if (p.status === "abono") {
        if (p.abonoGotas < s.cfg.abonoRevive) {
          p.abonoGotas++;
          log(s, "🍂 " + p.name + " (Abono) se refresca: " + p.abonoGotas + "/" + s.cfg.abonoRevive + " gotas.");
        }
        if (p.abonoGotas >= s.cfg.abonoRevive && canRevive(s)) {
          revive(s, p);
          s.turn = i;
          return;
        }
        continue;
      }
      s.turn = i;
      return;
    }
    fail("No se encontró el siguiente turno.");
  }

  function canRevive(s) { return alivePlayers(s).length > 2 && s.deck.length > 0; }

  function revive(s, p) {
    p.cards.push({ role: s.deck.pop(), lost: false });
    p.status = "alive";
    p.revived = true;
    p.abonoGotas = 0;
    p.water = s.cfg.reviveWater;
    log(s, "🌱 ¡" + p.name + " brota de nuevo! Vuelve con 1 planta y " + s.cfg.reviveWater + " gotas.");
  }

  // ---------- jugadas ----------

  function doAction(s, m) {
    if (s.phase !== "action") fail("Ahora no se puede elegir acción.");
    if (m.player !== s.turn) fail("No es tu turno.");
    const a = ACTIONS[m.action];
    if (!a) fail("Acción desconocida.");
    const p = s.players[m.player];
    if (p.water >= s.cfg.forceAt && m.action !== "exterminar")
      fail("Con " + s.cfg.forceAt + " gotas o más es obligatorio Exterminar.");
    const cost = a.cost ? s.cfg[a.cost] : 0;
    if (p.water < cost) fail("Te faltan gotas: necesitas " + cost + ".");
    let target = null;
    if (a.target) {
      target = s.players[m.target];
      if (!target || target.id === p.id || !isAlive(target)) fail("Elige un jugador vivo como objetivo.");
    }
    if (m.action === "soltarse" && !Object.values(s.vines).includes(p.id)) fail("No tienes ninguna Enredadera enganchada.");

    p.water -= cost;
    s.pending = { actor: p.id, action: m.action, target: target ? target.id : null, paid: cost };
    let txt = "▶️ " + p.name + ": " + a.name;
    if (a.role) txt += " (dice tener " + roleLabel(a.role) + ")";
    if (target) txt += " → " + target.name;
    log(s, txt + ".");

    if (a.role) return startClaim(s, p.id, a.role, "action");
    if (a.blockedBy) return startBlockWindow(s);
    return resolve(s);
  }

  function doPass(s, m) {
    if (s.phase === "challenge") {
      if (!s.pending.responders.includes(m.player)) fail("Este jugador no tiene que responder.");
      if (!s.pending.passed.includes(m.player)) s.pending.passed.push(m.player);
      if (s.pending.passed.length < s.pending.responders.length) return;
      // Nadie desafía.
      const c = s.pending.claim;
      if (c.kind === "action") return startBlockWindow(s);
      log(s, "🛡️ El bloqueo de " + nameOf(s, c.claimant) + " se mantiene.");
      return endTurn(s);
    }
    if (s.phase === "block") {
      if (!s.pending.blockers.includes(m.player)) fail("Este jugador no puede bloquear.");
      if (!s.pending.passed.includes(m.player)) s.pending.passed.push(m.player);
      if (s.pending.passed.length < s.pending.blockers.length) return;
      return resolve(s);
    }
    fail("Ahora no hay nada que pasar.");
  }

  function doPassAll(s) {
    if (s.phase === "challenge") {
      for (const id of s.pending.responders) if (!s.pending.passed.includes(id)) { doPass(s, { player: id }); if (s.phase !== "challenge") return; }
      return;
    }
    if (s.phase === "block") {
      for (const id of s.pending.blockers) if (!s.pending.passed.includes(id)) { doPass(s, { player: id }); if (s.phase !== "block") return; }
      return;
    }
    fail("Ahora no hay nada que pasar.");
  }

  function doChallenge(s, m) {
    if (s.phase !== "challenge") fail("Ahora no se puede desafiar.");
    if (!s.pending.responders.includes(m.player)) fail("Este jugador no puede desafiar.");
    if (s.pending.passed.includes(m.player)) fail("Este jugador ya dejó pasar.");
    const c = s.pending.claim;
    const claimant = s.players[c.claimant];
    const challenger = s.players[m.player];
    log(s, "❗ " + challenger.name + " desafía a " + claimant.name + ".");
    if (hasRole(claimant, c.role)) {
      // Decía la verdad: muestra la carta, la devuelve al mazo y roba otra.
      const idx = claimant.cards.findIndex((x) => !x.lost && x.role === c.role);
      s.deck.push(c.role);
      shuffle(s, s.deck);
      claimant.cards[idx] = { role: s.deck.pop(), lost: false };
      log(s, "✅ ¡" + claimant.name + " tenía " + roleLabel(c.role) + "! La cambia por otra del mazo.");
      const next = c.kind === "action" ? "block" : "blocked";
      return requireLoss(s, challenger.id, "desafío fallido", next);
    }
    log(s, "🦊 ¡Era astucia! " + claimant.name + " no tenía " + roleLabel(c.role) + ".");
    if (c.kind === "action") {
      // La acción falla. Se devuelve lo pagado (Cactus).
      if (s.pending.paid) claimant.water += s.pending.paid;
      return requireLoss(s, claimant.id, "lo descubrieron", "end");
    }
    // Era un bloqueo falso: el bloqueo falla y la acción sigue.
    return requireLoss(s, claimant.id, "lo descubrieron", "resolve");
  }

  function doBlock(s, m) {
    if (s.phase !== "block") fail("Ahora no se puede bloquear.");
    if (!s.pending.blockers.includes(m.player)) fail("Este jugador no puede bloquear.");
    const a = ACTIONS[s.pending.action];
    if (!a.blockedBy.includes(m.role)) fail("Esa planta no bloquea esta acción.");
    log(s, "🛡️ " + nameOf(s, m.player) + " bloquea diciendo tener " + roleLabel(m.role) + ".");
    s.pending.block = { player: m.player, role: m.role };
    startClaim(s, m.player, m.role, "block");
  }

  function doLose(s, m) {
    if (s.phase !== "lose") fail("Ahora no hay que perder ninguna carta.");
    const l = s.pending.loss;
    if (m.player !== l.player) fail("No te toca elegir.");
    s.phase = "resolving";
    loseCard(s, l.player, m.index, l.reason);
    if (s.phase === "over") return;
    s.pending.loss = null;
    continueFlow(s, l.next);
  }

  function doExchange(s, m) {
    if (s.phase !== "exchange") fail("Ahora no hay cambio de cartas.");
    const pd = s.pending;
    if (m.player !== pd.actor) fail("No te toca elegir.");
    const ex = pd.exchange;
    const keep = Array.from(new Set(m.keep || []));
    if (keep.length !== ex.keep || keep.some((i) => i < 0 || i >= ex.options.length)) fail("Elige exactamente " + ex.keep + (ex.keep === 1 ? " carta." : " cartas."));
    const p = s.players[pd.actor];
    const chosen = keep.map((i) => ex.options[i]);
    ex.options.forEach((r, i) => { if (!keep.includes(i)) s.deck.push(r); });
    shuffle(s, s.deck);
    let k = 0;
    p.cards.forEach((c) => { if (!c.lost) c.role = chosen[k++]; });
    log(s, "🌻 " + p.name + " cambia cartas con el mazo.");
    endTurn(s);
  }

  function dispatch(state, m) {
    if (state.phase === "over") fail("La partida terminó.");
    const s = clone(state);
    switch (m.type) {
      case "action":    doAction(s, m); break;
      case "pass":      doPass(s, m); break;
      case "passAll":   doPassAll(s); break;
      case "challenge": doChallenge(s, m); break;
      case "block":     doBlock(s, m); break;
      case "lose":      doLose(s, m); break;
      case "exchange":  doExchange(s, m); break;
      default: fail("Jugada desconocida.");
    }
    return s;
  }

  // ---------- consultas para la interfaz ----------

  // Acciones que el jugador del turno puede elegir, con motivo si no puede.
  function availableActions(s, pid) {
    const p = s.players[pid];
    const forced = p.water >= s.cfg.forceAt;
    const hooked = Object.values(s.vines).includes(pid);
    return Object.keys(ACTIONS).map((key) => {
      const a = ACTIONS[key];
      const cost = a.cost ? s.cfg[a.cost] : 0;
      let reason = null;
      if (key === "soltarse" && !hooked) reason = "No tienes Enredaderas encima";
      else if (forced && key !== "exterminar") reason = "Con " + s.cfg.forceAt + "+ gotas debes Exterminar";
      else if (p.water < cost) reason = "Necesitas " + cost + " gotas";
      return { key, name: a.name, role: a.role || null, cost, target: !!a.target, ok: !reason, reason, bluff: a.role ? !hasRole(p, a.role) : false };
    }).filter((x) => x.key !== "soltarse" || hooked);
  }

  // Quién tiene que decidir algo ahora mismo.
  function waitingFor(s) {
    switch (s.phase) {
      case "action": return [s.turn];
      case "challenge": return s.pending.responders.filter((id) => !s.pending.passed.includes(id));
      case "block": return s.pending.blockers.filter((id) => !s.pending.passed.includes(id));
      case "lose": return [s.pending.loss.player];
      case "exchange": return [s.pending.actor];
      default: return [];
    }
  }

  // Lo que un jugador puede ver: oculta las cartas vivas de los demás y el mazo (para el modo online).
  function viewFor(s, pid) {
    const v = clone(s);
    v.players.forEach((p) => {
      if (p.id !== pid) p.cards = p.cards.map((c) => (c.lost ? c : { role: null, lost: false }));
    });
    v.deckCount = v.deck.length;
    v.deck = [];
    if (v.pending && v.pending.exchange && v.pending.actor !== pid) v.pending.exchange.options = [];
    delete v.rng;
    return v;
  }

  const api = { ROLES, ROLE_INFO, ACTIONS, DEFAULT_CONFIG, newGame, dispatch, availableActions, waitingFor, viewFor, liveCards, isAlive };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Brotes = api;
})(typeof window !== "undefined" ? window : globalThis);
