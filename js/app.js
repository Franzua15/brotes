/* Brotes — interfaz del juego: modo online (cada uno en su móvil) y modo prueba (pasando el móvil). */
(function () {
  "use strict";
  const B = window.Brotes;
  const $ = (id) => document.getElementById(id);

  const IMG = {
    tronco: "assets/cartas/tronco.webp",
    girasol: "assets/cartas/girasol.webp",
    enredadera: "assets/cartas/enredadera.webp",
    cactus: "assets/cartas/cactus.webp",
    carnivora: "assets/cartas/carnivora.webp",
    abono: "assets/cartas/abono.webp",
  };
  const ICON = {
    gota: "assets/ui/gota.webp",
    gotas2: "assets/ui/gotas2.webp",
    diana: "assets/ui/diana.webp",
    habilidad: "assets/ui/habilidad.webp",
  };
  const COLORS = ["#e4572e", "#2e86de", "#f4a300", "#8e44ad", "#16a085", "#d35400", "#c2185b", "#3d5a80", "#6a9e1f", "#00838f"];

  const store = {
    get(k, d) { try { const v = localStorage.getItem("brotes." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("brotes." + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },
  };

  let S = null;                       // partida (completa en modo prueba, solo lo que ves en online)
  let mode = "local";                 // "local" (pasando el móvil) u "online"
  let count = store.get("count", 4);
  const names = store.get("names", []);
  const ui = { showAll: store.get("showAll", false), revealed: null, dialog: null, chosen: null, exSel: [], error: "" };
  // Datos de la sala online.
  const net = { code: null, token: null, seat: 0, room: null, version: 0, skew: 0, busy: false, sentTimeout: null, channel: null, live: false, poll: null };

  // ---------- utilidades ----------

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "style") e.style.cssText = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(kid));
    return e;
  }

  const roleName = (r) => B.ROLE_INFO[r].name;
  const initial = (n) => (n.trim()[0] || "?").toUpperCase();

  function avatar(p, extra) {
    return h("div", { class: "avatar" + (extra ? " " + extra : ""), style: "--c:" + COLORS[p.id % COLORS.length] }, initial(p.name));
  }

  function cardEl(card, opts) {
    opts = opts || {};
    const cls = "card" + (opts.size ? " " + opts.size : "");
    if (card.role && (opts.show || card.lost)) {
      return h("button", {
        class: cls + " face" + (card.lost ? " lost" : ""),
        type: "button",
        "aria-label": roleName(card.role) + (card.lost ? " (perdida)" : ""),
        onclick: opts.onclick || (() => zoom(IMG[card.role])),
      }, h("img", { src: IMG[card.role], alt: "" }));
    }
    return h("div", { class: cls + " back", "aria-label": "Carta oculta" });
  }

  function dropBadge(n, cls) {
    return h("span", { class: "drops " + (cls || "") }, h("img", { src: ICON.gota, alt: "" }), String(n));
  }

  // ---------- inicio ----------

  function renderSetup() {
    const chips = $("countChips");
    chips.innerHTML = "";
    for (let n = 2; n <= 10; n++) {
      chips.append(h("button", { type: "button", class: "chip" + (n === count ? " on" : ""), onclick: () => { saveNames(); count = n; store.set("count", n); renderSetup(); } }, String(n)));
    }
    const box = $("names");
    box.innerHTML = "";
    for (let i = 0; i < count; i++) {
      box.append(h("input", { class: "name-input", maxlength: "14", placeholder: "Jugador " + (i + 1), value: names[i] || "", "aria-label": "Nombre del jugador " + (i + 1) }));
    }
  }

  function saveNames() {
    document.querySelectorAll("#names .name-input").forEach((inp, i) => { names[i] = inp.value.trim(); });
    store.set("names", names);
  }

  function show(screen) {
    ["home", "setup", "lobby", "game"].forEach((id) => { $(id).hidden = id !== screen; });
    closeAll();
  }

  function start(sameNames) {
    if (!sameNames) saveNames();
    mode = "local";
    const list = Array.from({ length: count }, (_, i) => names[i] || "Jugador " + (i + 1));
    S = B.newGame(list);
    Object.assign(ui, { revealed: null, dialog: null, chosen: null, exSel: [], error: "" });
    $("newGameBtn").textContent = "🔄 Nueva partida";
    show("game");
    render();
  }

  // ---------- quién tiene el móvil ----------

  // El jugador cuyas cartas se ven abajo (el que tiene el móvil en este momento).
  function viewer() {
    if (mode === "online") return net.seat;
    switch (S.phase) {
      case "lose": return S.pending.loss.player;
      case "exchange": return S.pending.actor;
      case "over": return S.winner;
      default: return S.turn;
    }
  }
  const canSee = (id) => (mode === "online" ? id === net.seat : ui.showAll || ui.revealed === id);
  const needCurtain = () => mode === "local" && !ui.showAll && S.phase !== "over" && ui.revealed !== viewer();

  // ---------- jugar ----------

  function act(m) {
    if (mode === "online") return sendMove(m);
    try {
      S = B.dispatch(S, m);
      Object.assign(ui, { error: "", dialog: null, chosen: null, exSel: [] });
    } catch (e) {
      ui.error = e.message;
    }
    render();
  }

  function render() {
    if (!S) return;
    const me = viewer();
    $("roundInfo").textContent = "Ronda " + S.round;
    const ev = $("event");
    if (ev.textContent !== (S.lastEvent || "")) {
      ev.textContent = S.lastEvent || "";
      ev.classList.remove("flash"); void ev.offsetWidth; ev.classList.add("flash");
    }
    $("deckCount").textContent = S.deckCount != null ? S.deckCount : S.deck.length;
    placeDeck();
    renderSeats(me);
    renderMe(me);
    renderActions(me);
    renderDialog(me);
    renderCurtain(me);
  }

  // Pone el mazo justo en el centro del círculo de piedra del fondo.
  // El fondo se ajusta tipo "cover", así que se calcula dónde cae ese punto en esta pantalla.
  const BG = { w: 1600, h: 901, cx: 0.495, cy: 0.425 };
  function placeDeck() {
    const W = innerWidth, H = innerHeight;
    const scale = Math.max(W / BG.w, H / BG.h);
    const x = (W - BG.w * scale) / 2 + BG.cx * BG.w * scale;
    const y = (H - BG.h * scale) / 2 + BG.cy * BG.h * scale;
    // En pantallas muy bajas tus cartas lo taparían: se mueve a la izquierda, aún dentro del círculo.
    if (H < 520 && W > H) {
      const c = document.querySelector(".center");
      c.style.left = (x - BG.w * scale * 0.11) + "px";
      c.style.top = y + "px";
      return;
    }
    const c = document.querySelector(".center");
    c.style.left = x + "px";
    c.style.top = y + "px";
  }

  function vineInfo() {
    const on = {};
    for (const [o, v] of Object.entries(S.vines)) (on[v] = on[v] || []).push(S.players[o].name);
    return on;
  }

  function renderSeats(me) {
    const box = $("seats");
    box.innerHTML = "";
    const n = S.players.length;
    const waiting = B.waitingFor(S);
    const caught = vineInfo();
    const picking = ui.dialog === "target";
    // El punto más alto del arco queda justo debajo de la barra superior, mida lo que mida la pantalla.
    const H = $("game").clientHeight || innerHeight;
    const barBottom = document.querySelector(".hud-top").getBoundingClientRect().bottom;
    const avatarHalf = innerWidth >= 900 && innerHeight >= 600 ? 40 : 28;
    // En vertical el arco baja también por los costados para que quepan hasta 10 jugadores.
    const portrait = innerHeight > innerWidth;
    const spread = portrait ? 0.55 : 0;
    const cy = portrait ? 38 : innerHeight < 520 ? 60 : 50;
    const ry = Math.max(10, cy - ((barBottom + avatarHalf + 8) / H) * 100);
    for (let k = 1; k < n; k++) {
      const p = S.players[(me + k) % n];
      // Repartidos en arco alrededor de la mesa, de izquierda a derecha por arriba.
      const a = Math.PI - spread + (k * (Math.PI + 2 * spread)) / n;
      const x = 50 + Math.cos(a) * 41;
      const y = cy + Math.sin(a) * ry;
      const pickable = picking && p.status === "alive";
      const seat = h(pickable ? "button" : "div", {
        class: "seat " + p.status + (S.turn === p.id && S.phase !== "over" ? " turn" : "") + (waiting.includes(p.id) && S.turn !== p.id ? " waiting" : "") + (pickable ? " pickable" : "") + (S.winner === p.id ? " winner" : ""),
        style: "left:" + x.toFixed(2) + "%;top:" + y.toFixed(2) + "%",
        type: pickable ? "button" : null,
        onclick: pickable ? () => act({ type: "action", player: S.turn, action: ui.chosen, target: p.id }) : null,
      });
      const av = avatar(p);
      if (p.status === "alive") av.append(dropBadge(p.water, "on-avatar"));
      if (p.status === "abono") av.append(h("span", { class: "drops on-avatar abono" }, "🍂 " + p.abonoGotas));
      seat.append(av, h("div", { class: "pname" }, p.name));
      const mini = h("div", { class: "mini" });
      if (p.status === "abono") mini.append(h("button", { type: "button", class: "card tiny face abono", onclick: () => zoom(IMG.abono), "aria-label": "Abono" }, h("img", { src: IMG.abono, alt: "" })));
      p.cards.forEach((c) => mini.append(cardEl(c, { size: "tiny", show: ui.showAll })));
      seat.append(mini);
      if (S.vines[p.id] != null) seat.append(h("div", { class: "stag" }, "🌿 → " + S.players[S.vines[p.id]].name));
      if (caught[p.id]) seat.append(h("div", { class: "stag" }, "🪢 de " + caught[p.id].join(", ")));
      if (p.status === "out") seat.append(h("div", { class: "stag" }, "🥀 fuera"));
      box.append(seat);
    }
  }

  // Orden de las plantas en tu mano (como la guía).
  const HAND_ORDER = ["tronco", "girasol", "enredadera", "cactus", "carnivora"];

  function renderMe(me) {
    const p = S.players[me];
    const box = $("me");
    box.innerHTML = "";
    const see = canSee(me);
    const myTurn = S.phase === "action" && S.turn === me && !needCurtain();
    const acts = myTurn ? B.availableActions(S, me) : [];
    let hand;
    if (p.status === "abono") {
      hand = h("div", { class: "hand" }, h("button", { type: "button", class: "card big face", onclick: () => zoom(IMG.abono) }, h("img", { src: IMG.abono, alt: "Abono" })));
    } else if (p.status === "alive" && see) {
      // Las 5 plantas: a color las que tienes, en blanco y negro las que puedes usar con astucia.
      hand = h("div", { class: "hand5" + (myTurn ? " my-turn" : "") });
      for (const role of HAND_ORDER) {
        const n = p.cards.filter((c) => !c.lost && c.role === role).length;
        const usable = acts.filter((a) => a.role === role && a.ok);
        const blocked = myTurn && !usable.length;
        hand.append(h("button", {
          type: "button",
          class: "pcard " + (n ? "own" : "astucia") + (myTurn && usable.length ? " ready" : "") + (blocked ? " blocked" : ""),
          "aria-label": roleName(role) + (n ? " (la tienes)" : " (astucia)"),
          onclick: () => (myTurn && usable.length ? useRole(role) : zoom(IMG[role])),
        },
          h("img", { src: IMG[role], alt: "" }),
          h("span", { class: "pc-tag" }, n ? (n > 1 ? "✓ x" + n : "✓ Tuya") : "🦊 Astucia")));
      }
    } else {
      hand = h("div", { class: "hand" });
      if (p.status === "alive") p.cards.forEach((c) => { if (!c.lost) hand.append(cardEl(c, { size: "big", show: see })); });
    }
    const lost = p.status === "alive" ? p.cards.filter((c) => c.lost) : [];
    box.append(hand);
    const tag = h("div", { class: "me-tag" + (S.turn === me && S.phase !== "over" ? " turn" : "") }, avatar(p, "small"), p.name);
    if (lost.length) lost.forEach((c) => tag.append(cardEl(c, { size: "tiny" })));
    if (S.vines[me] != null) tag.append(h("span", { class: "stag" }, "🌿 → " + S.players[S.vines[me]].name));
    const caught = vineInfo()[me];
    if (caught) tag.append(h("span", { class: "stag" }, "🪢 de " + caught.join(", ")));
    box.append(tag);

    const w = $("water");
    w.innerHTML = "";
    if (p.status === "abono") w.append(h("span", { class: "big-num" }, "🍂 " + p.abonoGotas));
    else w.append(h("img", { src: ICON.gota, alt: "" }), h("span", { class: "big-num" }, String(p.water)));
  }

  function renderActions(me) {
    const box = $("actions");
    box.innerHTML = "";
    const myTurn = S.phase === "action" && S.turn === me && !needCurtain();
    const acts = myTurn ? B.availableActions(S, me) : [];
    const get = (k) => acts.find((a) => a.key === k);
    const btn = (icon, label, ok, why, fn) => h("button", {
      type: "button", class: "abtn" + (ok ? "" : " off"), disabled: !ok, title: why || label, onclick: fn,
    }, h("img", { src: ICON[icon], alt: "" }), h("span", null, label));
    const r = get("refrescar"), a = get("ayuda"), x = get("exterminar");
    box.append(
      btn("gota", "Refrescarse", r && r.ok, r && r.reason, () => act({ type: "action", player: me, action: "refrescar" })),
      btn("gotas2", "Ayuda", a && a.ok, a && a.reason, () => act({ type: "action", player: me, action: "ayuda" })),
      btn("diana", "Exterminar", x && x.ok, x && x.reason, () => { ui.dialog = "target"; ui.chosen = "exterminar"; render(); }),
    );
    if (myTurn) {
      const p = S.players[me];
      const hint = p.water >= S.cfg.forceAt ? "⚠️ Tienes " + p.water + " gotas: debes exterminar" : "Tu turno: elige una acción o toca una planta";
      box.prepend(h("div", { class: "turn-hint" }, hint));
    } else if (S.phase === "action" && mode === "online") {
      box.prepend(h("div", { class: "turn-hint" }, "Turno de " + S.players[S.turn].name + "…"));
    }
  }

  // Ventana para quien no tiene que decidir nada ahora (online).
  function waitBox(text) {
    $("dialog").classList.add("soft");
    const names = B.waitingFor(S).map((id) => (id === net.seat ? "ti" : S.players[id].name));
    return h("div", { class: "dbox wait" }, h("p", { class: "sub" }, text),
      names.length ? h("p", { class: "waiting-for" }, "⏳ Esperando a: " + names.join(", ")) : null);
  }

  // ---------- ventanas ----------

  function dbox(title, sub, ...body) {
    return h("div", { class: "dbox" },
      ui.error ? h("p", { class: "error" }, "⚠️ " + ui.error) : null,
      h("h3", null, title), sub ? h("p", { class: "sub" }, sub) : null, ...body);
  }

  function renderDialog(me) {
    const d = $("dialog");
    d.innerHTML = "";
    d.hidden = true;
    d.classList.remove("soft");
    if (needCurtain()) return;
    const pd = S.pending;
    let box = null;

    const online = mode === "online";
    const waiting = B.waitingFor(S);
    const iDecide = waiting.includes(me);

    if (S.phase === "over") {
      const w = S.players[S.winner];
      if (online) {
        const host = net.seat === 0;
        box = dbox("🏆 ¡" + w.name + " gana!", "El último jardín en pie.",
          host ? h("button", { class: "btn big", onclick: () => netCall("start").then(applyView, showNetError) }, "🌱 Jugar otra vez")
               : h("p", { class: "sub" }, "Esperando a que " + net.room.players[0] + " empiece otra partida…"),
          h("button", { class: "btn ghost", onclick: leaveRoom }, "🚪 Salir de la sala"));
      } else {
        box = dbox("🏆 ¡" + w.name + " gana!", "El último jardín en pie.",
          h("div", { class: "row" },
            h("button", { class: "btn big", onclick: () => start(true) }, "🌱 Jugar otra vez"),
            h("button", { class: "btn ghost", onclick: backToSetup }, "👥 Cambiar jugadores")));
      }
    } else if (online && (S.phase === "challenge" || S.phase === "block") && !iDecide) {
      const c = pd.claim;
      const actor = S.players[pd.actor].name;
      let txt;
      if (S.phase === "challenge") {
        const who = c.claimant === me ? "Tú" : S.players[c.claimant].name;
        txt = c.kind === "block" ? "🛡️ " + who + " bloquea con " + roleName(c.role) + ". ¿Alguien lo desafía?"
          : "⭐ " + who + (c.claimant === me ? " usas " : " usa ") + roleName(c.role) + ". ¿Alguien lo desafiará?";
      } else {
        txt = "🛡️ " + (pd.actor === me ? "Tu acción" : "La acción de " + actor) + " se puede bloquear. Esperando…";
      }
      box = waitBox(txt);
    } else if (online && S.phase === "lose" && pd.loss.player !== me) {
      box = waitBox("💀 " + S.players[pd.loss.player].name + " está eligiendo qué planta pierde…");
    } else if (online && S.phase === "exchange" && pd.actor !== me) {
      box = waitBox("🌻 " + S.players[pd.actor].name + " está cambiando cartas con el mazo…");
    } else if (online && S.phase === "challenge") {
      const c = pd.claim;
      const who = S.players[c.claimant].name;
      const txt = c.kind === "block"
        ? who + " bloquea con " + roleName(c.role)
        : who + " usa " + roleName(c.role) + ": " + B.ACTIONS[pd.action].name.toLowerCase() + (pd.target != null ? " → " + (pd.target === me ? "tú" : S.players[pd.target].name) : "");
      box = dbox("🤔 ¿Lo desafías?", txt,
        h("button", { class: "claim-card", type: "button", onclick: () => zoom(IMG[c.role]) }, h("img", { src: IMG[c.role], alt: roleName(c.role) })),
        h("div", { class: "row" },
          h("button", { class: "btn warn big", onclick: () => act({ type: "challenge", player: me }) }, "❗ Desafiar"),
          h("button", { class: "btn ok big", onclick: () => act({ type: "pass", player: me }) }, "✓ Dejar pasar")));
    } else if (online && S.phase === "block") {
      const a = B.ACTIONS[pd.action];
      const grid = h("div", { class: "grid" });
      a.blockedBy.forEach((r) => grid.append(h("button", { class: "btn role-" + r, onclick: () => act({ type: "block", player: me, role: r }) }, "🛡️ Bloquear", h("small", null, "con " + roleName(r)))));
      box = dbox("🛡️ ¿Lo bloqueas?", S.players[pd.actor].name + ": " + a.name.toLowerCase() + (pd.target != null ? " → " + (pd.target === me ? "tú" : S.players[pd.target].name) : ""),
        grid, h("button", { class: "btn big ok", onclick: () => act({ type: "pass", player: me }) }, "✓ No bloquear"));
    } else if (S.phase === "action" && ui.dialog === "astucia") {
      box = astuciaBox(me);
    } else if (S.phase === "action" && ui.dialog === "tronco") {
      box = troncoBox(me);
    } else if (S.phase === "action" && ui.dialog === "target") {
      box = targetBox(me);
      d.classList.add("soft");
    } else if (S.phase === "challenge") {
      const c = pd.claim;
      const who = S.players[c.claimant].name;
      const txt = c.kind === "block"
        ? who + " bloquea con " + roleName(c.role)
        : who + " usa " + roleName(c.role) + ": " + B.ACTIONS[pd.action].name.toLowerCase() + (pd.target != null ? " → " + S.players[pd.target].name : "");
      const grid = h("div", { class: "grid" });
      B.waitingFor(S).forEach((id) => grid.append(h("button", { class: "btn warn", onclick: () => act({ type: "challenge", player: id }) }, avatar(S.players[id], "tiny"), S.players[id].name + " desafía")));
      box = dbox("🤔 ¿Alguien lo desafía?", txt,
        h("button", { class: "claim-card", type: "button", onclick: () => zoom(IMG[c.role]) }, h("img", { src: IMG[c.role], alt: roleName(c.role) })),
        grid,
        h("button", { class: "btn big ok", onclick: () => act({ type: "passAll" }) }, "✓ Nadie desafía"));
    } else if (S.phase === "block") {
      const a = B.ACTIONS[pd.action];
      const grid = h("div", { class: "grid" });
      B.waitingFor(S).forEach((id) => a.blockedBy.forEach((r) =>
        grid.append(h("button", { class: "btn role-" + r, onclick: () => act({ type: "block", player: id, role: r }) }, "🛡️ " + S.players[id].name, h("small", null, "con " + roleName(r))))));
      box = dbox("🛡️ ¿Alguien lo bloquea?", S.players[pd.actor].name + ": " + a.name.toLowerCase() + (pd.target != null ? " → " + S.players[pd.target].name : ""),
        grid, h("button", { class: "btn big ok", onclick: () => act({ type: "passAll" }) }, "✓ Nadie bloquea"));
    } else if (S.phase === "lose") {
      const p = S.players[pd.loss.player];
      const row = h("div", { class: "pick" });
      p.cards.forEach((c, i) => { if (!c.lost) row.append(cardEl(c, { size: "big", show: true, onclick: () => act({ type: "lose", player: p.id, index: i }) })); });
      box = dbox("💀 " + p.name + ", pierdes una planta", "Motivo: " + pd.loss.reason + ". Toca la que quieres perder.", row);
    } else if (S.phase === "exchange") {
      const ex = pd.exchange;
      const row = h("div", { class: "pick" });
      ex.options.forEach((r, i) => {
        const on = ui.exSel.includes(i);
        const el = cardEl({ role: r }, { size: "big", show: true, onclick: () => {
          if (on) ui.exSel = ui.exSel.filter((x) => x !== i);
          else if (ui.exSel.length < ex.keep) ui.exSel.push(i);
          render();
        } });
        if (on) el.classList.add("sel");
        row.append(el);
      });
      box = dbox("🌻 Cambia tus cartas", "Elige " + ex.keep + (ex.keep === 1 ? " carta" : " cartas") + " para quedarte.", row,
        h("button", { class: "btn big ok", disabled: ui.exSel.length !== ex.keep, onclick: () => act({ type: "exchange", player: pd.actor, keep: ui.exSel }) }, "✓ Quedarme con estas"));
    }
    if (!box) return;
    d.append(box);
    d.hidden = false;
  }

  // Tocar una planta de tu mano.
  function useRole(role) {
    const me = viewer();
    const p = S.players[me];
    const own = p.cards.some((c) => !c.lost && c.role === role);
    const usable = B.availableActions(S, me).filter((a) => a.role === role && a.ok);
    if (!usable.length) return;
    if (usable.length > 1) { ui.dialog = "tronco"; ui.chosen = null; render(); return; }
    if (!own) { ui.dialog = "astucia"; ui.chosen = usable[0].key; render(); return; }
    go(usable[0].key);
  }

  // Ejecuta la habilidad (pide objetivo si hace falta).
  function go(key) {
    const a = B.ACTIONS[key];
    if (a.target) { ui.dialog = "target"; ui.chosen = key; render(); return; }
    act({ type: "action", player: viewer(), action: key });
  }

  function astuciaBox(me) {
    const a = B.ACTIONS[ui.chosen];
    return dbox("🦊 Usar con astucia", "No tienes " + roleName(a.role) + ", pero puedes usarla igual. Si alguien te desafía, pierdes una planta.",
      h("button", { class: "claim-card", type: "button", onclick: () => zoom(IMG[a.role]) }, h("img", { src: IMG[a.role], alt: roleName(a.role) })),
      h("p", { class: "sub center-text" }, a.name + (a.cost ? " · " + S.cfg[a.cost] + " gotas" : "")),
      h("div", { class: "row" },
        h("button", { class: "btn big role-" + a.role, onclick: () => go(ui.chosen) }, "🦊 Usar con astucia"),
        h("button", { class: "btn ghost", onclick: () => { ui.dialog = null; ui.chosen = null; render(); } }, "Cancelar")));
  }

  function troncoBox(me) {
    const own = S.players[me].cards.some((c) => !c.lost && c.role === "tronco");
    const usable = B.availableActions(S, me).filter((a) => a.role === "tronco" && a.ok);
    return dbox("🌳 Tronco Robusto", own ? "¿Qué quieres hacer?" : "🦊 No lo tienes: lo usas con astucia. Si alguien te desafía, pierdes una planta.",
      h("div", { class: "grid" }, usable.map((a) => h("button", { class: "btn role-tronco", onclick: () => go(a.key) }, a.key === "soltarse" ? "🪢 Soltarme de la Enredadera" : "💧 Robar 2 gotas"))),
      h("button", { class: "btn ghost", onclick: () => { ui.dialog = null; render(); } }, "Cancelar"));
  }

  function targetBox(me) {
    const a = B.ACTIONS[ui.chosen];
    const grid = h("div", { class: "grid" });
    S.players.filter((q) => q.status === "alive" && q.id !== me).forEach((q) =>
      grid.append(h("button", { class: "btn target", onclick: () => act({ type: "action", player: me, action: ui.chosen, target: q.id }) },
        h("span", { class: "trow" }, avatar(q, "tiny"), q.name), h("small", null, "💧 " + q.water + " · " + B.liveCards(q).length + (B.liveCards(q).length === 1 ? " planta" : " plantas")))));
    return dbox("🎯 " + a.name + ": ¿a quién?", "Toca un jugador aquí o en la mesa.", grid,
      h("button", { class: "btn ghost", onclick: () => { ui.dialog = null; ui.chosen = null; render(); } }, "← Volver"));
  }

  function renderCurtain(me) {
    const c = $("curtain");
    c.innerHTML = "";
    if (!needCurtain()) { c.hidden = true; return; }
    const p = S.players[me];
    let why = "Es tu turno";
    if (S.phase === "lose") why = "Debes elegir qué planta pierdes";
    if (S.phase === "exchange") why = "Debes elegir tus cartas";
    c.append(h("div", { class: "cbox" },
      avatar(p, "huge"),
      h("p", { class: "c1" }, "Pásale el móvil a"),
      h("p", { class: "c2" }, p.name),
      h("p", { class: "c3" }, why),
      h("p", { class: "c4" }, S.lastEvent || ""),
      h("button", { class: "btn big", onclick: () => { ui.revealed = me; render(); } }, "👀 Soy " + p.name)));
    c.hidden = false;
  }

  function renderLog() {
    const ol = $("log");
    ol.innerHTML = "";
    if (S) S.log.slice().reverse().forEach((l) => ol.append(h("li", null, l)));
  }

  function backToSetup() {
    S = null;
    show("setup");
    renderSetup();
  }

  // ---------- modo online ----------

  const CFG = window.BROTES_CONFIG || {};
  const FN_URL = CFG.url + "/functions/v1/brotes";

  async function netCall(op, extra) {
    const res = await fetch(FN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: CFG.key },
      body: JSON.stringify(Object.assign({ op, code: net.code, token: net.token }, extra || {})),
    });
    let body = {};
    try { body = await res.json(); } catch (e) { /* sin cuerpo */ }
    if (!res.ok) throw new Error(body.error || "No hay conexión con el servidor.");
    return body;
  }

  function showNetError(e) {
    const msg = e && e.message ? e.message : "No hay conexión con el servidor.";
    if (!$("game").hidden) { ui.error = msg; render(); }
    else if (!$("lobby").hidden) { $("lobbyError").textContent = "⚠️ " + msg; $("lobbyError").hidden = false; }
    else { $("homeError").textContent = "⚠️ " + msg; $("homeError").hidden = false; }
  }

  // Aplica lo que devuelve el servidor y muestra la pantalla que toque.
  function applyView(v) {
    if (!v || !v.room) return;
    // Sin cambios desde la última vez: no se redibuja (así no se pierde un toque a medias).
    if (v.room.version === net.version && v.room.code === net.code && v.seat === net.seat && (S || !$("lobby").hidden)) return;
    if (v.token) net.token = v.token;
    net.code = v.room.code;
    net.seat = v.seat;
    net.room = v.room;
    net.version = v.room.version;
    store.set("session", { code: net.code, token: net.token });
    if (v.room.status === "lobby" || !v.state) {
      S = null;
      renderLobby();
      if ($("lobby").hidden) show("lobby");
      return;
    }
    const fresh = !S || S.log.length !== v.state.log.length || S.phase !== v.state.phase;
    S = v.state;
    net.skew = Date.now() - v.state.now;
    if (fresh) Object.assign(ui, { error: "", dialog: S.phase === "action" ? ui.dialog : null, chosen: S.phase === "action" ? ui.chosen : null, exSel: S.phase === "exchange" ? ui.exSel : [] });
    if (S.phase !== "action" || S.turn !== net.seat) { ui.dialog = null; ui.chosen = null; }
    mode = "online";
    $("newGameBtn").textContent = "🚪 Salir de la sala";
    if ($("game").hidden) show("game");
    render();
  }

  async function refresh() {
    if (!net.code || !net.token || net.busy) return;
    try { applyView(await netCall("view")); }
    catch (e) {
      if (/No existe|No formas parte/.test(e.message)) { forgetSession(); show("home"); showNetError(e); }
    }
  }

  async function sendMove(m) {
    if (net.busy) return;
    net.busy = true;
    try {
      applyView(await netCall("move", { move: m }));
    } catch (e) {
      ui.error = e.message;
      render();
    } finally {
      net.busy = false;
    }
  }

  // Tiempo real: el servidor avisa por este canal cada vez que cambia algo.
  function connectLive() {
    disconnectLive();
    try {
      if (!window.supabase || !CFG.url) throw new Error("sin librería");
      const client = net.client || (net.client = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: false } }));
      net.channel = client.channel("brotes-" + net.code)
        .on("broadcast", { event: "update" }, (msg) => { if (!msg.payload || msg.payload.v > net.version) refresh(); })
        .subscribe((status) => { net.live = status === "SUBSCRIBED"; if (net.live) refresh(); });
    } catch (e) { net.live = false; }
    // Respaldo por si el tiempo real se corta: consulta cada pocos segundos.
    net.poll = setInterval(() => { if (!document.hidden) refresh(); }, 4000);
  }
  function disconnectLive() {
    if (net.poll) clearInterval(net.poll);
    net.poll = null;
    if (net.channel && net.client) net.client.removeChannel(net.channel);
    net.channel = null;
    net.live = false;
  }

  function forgetSession() {
    disconnectLive();
    store.set("session", null);
    Object.assign(net, { code: null, token: null, room: null, version: 0 });
    S = null;
    mode = "local";
  }

  async function leaveRoom() {
    if (net.room && net.room.status === "lobby" && net.seat !== 0) { try { await netCall("leave"); } catch (e) { /* ya no estaba */ } }
    forgetSession();
    show("home");
  }

  function myName() {
    const n = $("myName").value.trim();
    if (!n) { $("myName").focus(); throw new Error("Escribe tu nombre."); }
    store.set("myName", n);
    return n;
  }

  async function createRoom() {
    $("homeError").hidden = true;
    try {
      const name = myName();
      net.code = null; net.token = null;
      $("createBtn").disabled = true;
      applyView(await netCall("create", { name }));
      connectLive();
    } catch (e) { showNetError(e); }
    finally { $("createBtn").disabled = false; }
  }

  async function joinRoom() {
    $("homeError").hidden = true;
    try {
      const name = myName();
      const code = $("joinCode").value.trim().toUpperCase();
      if (code.length < 4) { $("joinCode").focus(); throw new Error("Escribe el código de la sala."); }
      const saved = store.get("session", null);
      net.code = code;
      net.token = saved && saved.code === code ? saved.token : null;
      $("joinBtn").disabled = true;
      applyView(await netCall("join", { name }));
      connectLive();
    } catch (e) { net.code = null; showNetError(e); }
    finally { $("joinBtn").disabled = false; }
  }

  function renderLobby() {
    const r = net.room;
    $("lobbyCode").textContent = r.code;
    $("lobbyCount").textContent = "Jugadores (" + r.players.length + "/10)";
    const ul = $("lobbyPlayers");
    ul.innerHTML = "";
    r.players.forEach((n, i) => ul.append(h("li", null, avatar({ id: i, name: n }, "small"), n,
      i === 0 ? h("em", null, "👑 crea la sala") : null, i === net.seat ? h("em", null, "tú") : null)));
    const host = net.seat === 0;
    $("lobbyStart").hidden = !host;
    $("lobbyStart").disabled = r.players.length < 2;
    $("lobbyStart").textContent = r.players.length < 2 ? "Esperando jugadores…" : "🌱 Empezar partida";
    $("lobbyWait").textContent = host ? "Comparte el código. Cuando estén todos, pulsa empezar." : "Esperando a que " + r.players[0] + " empiece la partida…";
    $("lobbyLeave").textContent = host ? "Cerrar y volver al inicio" : "Salir de la sala";
  }

  async function shareRoom() {
    const url = location.origin + location.pathname + "?sala=" + net.code;
    const text = "¡Juega a Brotes conmigo! Código de sala: " + net.code;
    try {
      if (navigator.share) { await navigator.share({ title: "Brotes", text, url }); return; }
    } catch (e) { return; }
    try {
      await navigator.clipboard.writeText(text + " " + url);
      $("shareBtn").textContent = "✅ Enlace copiado";
      setTimeout(() => { $("shareBtn").textContent = "📤 Invitar amigos"; }, 2000);
    } catch (e) {
      prompt("Copia este enlace:", url);
    }
  }

  document.addEventListener("visibilitychange", () => { if (!document.hidden && mode === "online") refresh(); });

  // ---------- guía, carta en grande y menú ----------

  const SLIDES = [
    { tab: "Personajes", img: "assets/guia/personajes.webp" },
    { tab: "Acciones", img: "assets/guia/acciones.webp" },
    { tab: "🌳", img: IMG.tronco },
    { tab: "🌻", img: IMG.girasol },
    { tab: "🌿", img: IMG.enredadera },
    { tab: "🌵", img: IMG.cactus },
    { tab: "🪴", img: IMG.carnivora },
    { tab: "🍂", img: IMG.abono },
    { tab: "Reglas", html:
      "<h3>📜 Reglas rápidas</h3><ul>" +
      "<li><b>Inicio:</b> cada jugador recibe 2 cartas boca abajo y 2 gotas.</li>" +
      "<li><b>En tu turno</b> haces una sola acción: 💧 refrescarte (+1), 💧💧 pedir ayuda (+2), 🎯 exterminar (8 gotas) o tocar una de tus plantas para usar su habilidad.</li>" +
      "<li><b>Tu mano:</b> abajo ves las 5 plantas. A color, las que tienes; en blanco y negro, las que puedes usar con <b>astucia</b> aunque no las tengas.</li>" +
      "<li><b>Desafiar:</b> si crees que alguien no tiene la planta que dice, desafíalo. Si no la tenía, pierde una planta. Si la tenía, pierdes tú una planta y él cambia esa carta por otra del mazo.</li>" +
      "<li><b>Bloquear:</b> también se bloquea diciendo tener una planta, y el bloqueo también se puede desafiar.</li>" +
      "<li><b>Con 11 gotas o más</b> es obligatorio exterminar.</li>" +
      "<li><b>Enredadera:</b> se queda enganchada hasta que la víctima se suelte con un Tronco, o hasta que su dueño pierda una carta.</li>" +
      "<li><b>Abono:</b> al perder tus 2 plantas eres Abono. Ganas 1 gota cada turno y con 6 vuelves con 1 planta y 2 gotas. Solo una vez por partida y nunca si quedan 2 jugadores.</li>" +
      "<li><b>Gana</b> el último jugador con plantas vivas.</li></ul>" },
  ];

  function buildGuide() {
    const slides = $("slides"), tabs = $("guideTabs"), dots = $("dots");
    SLIDES.forEach((s, i) => {
      const sl = h("div", { class: "slide" + (s.html ? " text" : "") });
      if (s.img) sl.append(h("img", { src: s.img, alt: s.tab, loading: "lazy" }));
      else sl.innerHTML = s.html;
      slides.append(sl);
      tabs.append(h("button", { type: "button", class: "gtab", onclick: () => goSlide(i) }, s.tab));
      dots.append(h("i"));
    });
    slides.addEventListener("scroll", () => { clearTimeout(slides._t); slides._t = setTimeout(markSlide, 60); }, { passive: true });
    $("prevSlide").onclick = () => goSlide(curSlide() - 1);
    $("nextSlide").onclick = () => goSlide(curSlide() + 1);
  }
  const curSlide = () => Math.round($("slides").scrollLeft / $("slides").clientWidth);
  function goSlide(i) {
    const sl = $("slides");
    i = Math.max(0, Math.min(SLIDES.length - 1, i));
    sl.scrollTo({ left: i * sl.clientWidth, behavior: "smooth" });
    setTimeout(markSlide, 350);
  }
  function markSlide() {
    const i = curSlide();
    document.querySelectorAll("#dots i").forEach((d, k) => d.classList.toggle("on", k === i));
    document.querySelectorAll(".gtab").forEach((d, k) => d.classList.toggle("on", k === i));
    const tab = document.querySelectorAll(".gtab")[i];
    if (tab) tab.scrollIntoView({ block: "nearest", inline: "center" });
  }

  function open(id) { $(id).hidden = false; }
  function closeAll() { ["guide", "zoom", "menu"].forEach((id) => ($(id).hidden = true)); }
  function zoom(src) { $("zoom").querySelector("img").src = src; open("zoom"); }

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-open-guide]")) { open("guide"); requestAnimationFrame(markSlide); }
    if (e.target.closest("[data-close]")) closeAll();
    if (e.target.classList && e.target.classList.contains("sheet")) closeAll();
    else if (e.target.closest("#zoom")) closeAll();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });
  let resizeT;
  addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(render, 120); });

  // ---------- arranque ----------

  $("startBtn").onclick = () => start(false);
  $("localBtn").onclick = () => { show("setup"); renderSetup(); };
  $("backHome").onclick = () => show("home");
  $("createBtn").onclick = createRoom;
  $("joinBtn").onclick = joinRoom;
  $("joinCode").addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });
  $("joinCode").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
  $("shareBtn").onclick = shareRoom;
  $("lobbyStart").onclick = () => { $("lobbyError").hidden = true; netCall("start").then(applyView, showNetError); };
  $("lobbyLeave").onclick = leaveRoom;
  $("menuBtn").onclick = () => {
    renderLog();
    $("showAll").closest("label").hidden = mode === "online";
    open("menu");
  };
  $("newGameBtn").onclick = () => { if (mode === "online") leaveRoom(); else backToSetup(); };
  $("showAll").checked = ui.showAll;
  $("showAll").onchange = (e) => { ui.showAll = e.target.checked; store.set("showAll", ui.showAll); render(); };
  buildGuide();
  renderSetup();

  // Inicio: nombre guardado, código del enlace de invitación y volver a la sala si se recargó la página.
  $("myName").value = store.get("myName", "");
  const linkCode = new URLSearchParams(location.search).get("sala");
  if (linkCode) $("joinCode").value = linkCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  const session = store.get("session", null);
  if (session && session.code && session.token && (!linkCode || linkCode.toUpperCase() === session.code)) {
    net.code = session.code;
    net.token = session.token;
    netCall("view").then((v) => { applyView(v); connectLive(); }).catch(() => { forgetSession(); });
  }
})();
