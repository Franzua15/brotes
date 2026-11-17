/* Brotes — interfaz del modo prueba (todos en una pantalla). */
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

  const store = {
    get(k, d) { try { const v = localStorage.getItem("brotes." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("brotes." + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },
  };

  let S = null;                       // estado de la partida
  let count = store.get("count", 4);
  let names = store.get("names", []);
  const ui = { showAll: store.get("showAll", false), picking: null, exSel: [], peek: null, error: "" };

  // ---------- utilidades de dibujo ----------

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (k === "html") e.innerHTML = v;
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(kid));
    return e;
  }

  const roleName = (r) => B.ROLE_INFO[r].emoji + " " + B.ROLE_INFO[r].name;
  const drops = (n) => "💧" + n;

  function cardEl(card, opts) {
    opts = opts || {};
    if (card.role && (opts.show || card.lost)) {
      return h("button", {
        class: "card face" + (card.lost ? " lost" : "") + (opts.big ? " big" : ""),
        type: "button",
        "aria-label": B.ROLE_INFO[card.role].name + (card.lost ? " (perdida)" : ""),
        onclick: opts.onclick || (() => zoom(IMG[card.role])),
      }, h("img", { src: IMG[card.role], alt: "" }));
    }
    return h("div", { class: "card back" + (opts.big ? " big" : ""), "aria-label": "Carta oculta" });
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
      box.append(h("input", { class: "name-input", maxlength: "18", placeholder: "Jugador " + (i + 1), value: names[i] || "", "aria-label": "Nombre del jugador " + (i + 1) }));
    }
  }

  function saveNames() {
    const vals = Array.from(document.querySelectorAll(".name-input")).map((i) => i.value.trim());
    vals.forEach((v, i) => { names[i] = v; });
    store.set("names", names);
  }

  function start(sameNames) {
    if (!sameNames) saveNames();
    const list = Array.from({ length: count }, (_, i) => names[i] || "Jugador " + (i + 1));
    S = B.newGame(list);
    ui.picking = null; ui.exSel = []; ui.peek = null; ui.error = "";
    $("setup").hidden = true;
    $("game").hidden = false;
    render();
  }

  // ---------- partida ----------

  function act(m) {
    try {
      S = B.dispatch(S, m);
      ui.error = "";
      ui.picking = null;
      ui.exSel = [];
      ui.peek = null;
    } catch (e) {
      ui.error = e.message;
    }
    render();
  }

  function render() {
    if (!S) return;
    $("roundInfo").textContent = "Ronda " + S.round;
    const ev = $("event");
    ev.textContent = S.lastEvent || "";
    ev.classList.remove("flash"); void ev.offsetWidth; ev.classList.add("flash");
    renderTable();
    renderPanel();
    renderLog();
  }

  function renderTable() {
    const t = $("table");
    t.innerHTML = "";
    const waiting = B.waitingFor(S);
    const vineOwners = {};
    for (const [o, v] of Object.entries(S.vines)) (vineOwners[v] = vineOwners[v] || []).push(S.players[o].name);

    for (const p of S.players) {
      const isTurn = S.phase !== "over" && S.turn === p.id;
      const show = ui.showAll || ui.peek === p.id;
      const seat = h("div", {
        class: "seat" + (p.cards.length + (p.status === "abono" ? 1 : 0) > 2 ? " many" : "") + (isTurn ? " turn" : "") + (waiting.includes(p.id) && !isTurn ? " waiting" : "") + " " + p.status + (S.winner === p.id ? " winner" : ""),
      });
      seat.append(h("div", { class: "seat-head" },
        h("span", { class: "pname" }, (isTurn ? "▶ " : "") + p.name),
        p.status === "alive" ? h("span", { class: "water" }, drops(p.water)) : null));

      if (p.status === "alive") {
        seat.append(h("div", { class: "cards" }, p.cards.map((c) => cardEl(c, { show }))));
        const peekBtn = h("button", { type: "button", class: "peek", "aria-label": "Ver las cartas de " + p.name }, ui.peek === p.id ? "🙈 Ocultar" : "👁 Mis cartas");
        peekBtn.addEventListener("click", () => { ui.peek = ui.peek === p.id ? null : p.id; render(); });
        if (!ui.showAll) seat.append(peekBtn);
      } else if (p.status === "abono") {
        const pct = Math.round((p.abonoGotas / S.cfg.abonoRevive) * 100);
        seat.append(h("div", { class: "cards" },
          h("button", { type: "button", class: "card face abono", onclick: () => zoom(IMG.abono), "aria-label": "Carta de Abono" }, h("img", { src: IMG.abono, alt: "" })),
          p.cards.map((c) => cardEl(c))));
        seat.append(h("div", { class: "abono-bar", title: "Gotas de abono" },
          h("i", { style: "width:" + pct + "%" }), h("span", null, "🍂 " + p.abonoGotas + "/" + S.cfg.abonoRevive)));
      } else {
        seat.append(h("div", { class: "cards" }, p.cards.map((c) => cardEl(c))));
        seat.append(h("div", { class: "tag" }, "🥀 Fuera"));
      }

      const tags = [];
      if (S.vines[p.id] != null) tags.push("🌿 enganchada a " + S.players[S.vines[p.id]].name);
      if (vineOwners[p.id]) tags.push("🪢 atrapado por " + vineOwners[p.id].join(", "));
      if (p.revived && p.status === "alive") tags.push("🌱 rebrotó");
      if (p.status === "alive" && p.water >= S.cfg.forceAt) tags.push("⚠️ debe exterminar");
      tags.forEach((x) => seat.append(h("div", { class: "tag" }, x)));
      t.append(seat);
    }
  }

  function panelTitle(text, sub) {
    return [h("h3", null, text), sub ? h("p", { class: "sub" }, sub) : null];
  }

  function renderPanel() {
    const P = $("panel");
    P.innerHTML = "";
    if (ui.error) P.append(h("p", { class: "error" }, "⚠️ " + ui.error));
    const pd = S.pending;

    if (S.phase === "over") {
      P.append(...panelTitle("🏆 ¡" + S.players[S.winner].name + " gana!", "El último jardín en pie."));
      P.append(h("div", { class: "row" },
        h("button", { class: "btn big", onclick: () => start(true) }, "🌱 Jugar otra vez"),
        h("button", { class: "btn ghost", onclick: backToSetup }, "👥 Cambiar jugadores")));
      return;
    }

    if (S.phase === "action") {
      const p = S.players[S.turn];
      const acts = B.availableActions(S, p.id);
      if (ui.picking) {
        const a = acts.find((x) => x.key === ui.picking);
        P.append(...panelTitle(p.name + ": " + a.name, "¿A quién?"));
        const row = h("div", { class: "grid targets" });
        S.players.filter((q) => q.status === "alive" && q.id !== p.id).forEach((q) =>
          row.append(h("button", { class: "btn target", onclick: () => act({ type: "action", player: p.id, action: a.key, target: q.id }) },
            q.name, h("small", null, drops(q.water) + " · " + B.liveCards(q).length + (B.liveCards(q).length === 1 ? " planta" : " plantas")))));
        P.append(row, h("button", { class: "btn ghost small", onclick: () => { ui.picking = null; render(); } }, "← Volver"));
        return;
      }
      P.append(...panelTitle("🌱 Turno de " + p.name, "Tienes " + p.water + (p.water === 1 ? " gota" : " gotas") + ". Elige una acción."));
      const basic = h("div", { class: "grid" });
      const roles = h("div", { class: "grid" });
      for (const a of acts) {
        const label = a.role ? B.ROLE_INFO[a.role].emoji + " " + a.name : ({ refrescar: "💧 ", ayuda: "🏞️ ", exterminar: "☠️ " }[a.key] || "") + a.name;
        const extra = [];
        if (a.cost) extra.push("cuesta " + a.cost);
        if (a.role) extra.push(B.ROLE_INFO[a.role].name);
        const btn = h("button", {
          class: "btn act" + (a.role ? " role-" + a.role : " basic") + (a.ok ? "" : " off"),
          disabled: !a.ok,
          onclick: () => {
            if (a.target) { ui.picking = a.key; render(); }
            else act({ type: "action", player: p.id, action: a.key });
          },
        }, label, h("small", null, a.ok ? extra.join(" · ") : a.reason),
          a.role && (ui.showAll || ui.peek === p.id) ? h("em", { class: a.bluff ? "bluff" : "truth" }, a.bluff ? "🤥 farol" : "✓ la tienes") : null);
        (a.role ? roles : basic).append(btn);
      }
      P.append(h("p", { class: "group" }, "Acciones básicas"), basic, h("p", { class: "group" }, "Habilidades · puedes decir la verdad o mentir"), roles);
      return;
    }

    if (S.phase === "challenge") {
      const c = pd.claim;
      const who = S.players[c.claimant].name;
      const what = c.kind === "block"
        ? who + " bloquea diciendo tener " + roleName(c.role) + "."
        : who + " dice tener " + roleName(c.role) + (pd.target != null ? " → " + S.players[pd.target].name : "") + ".";
      P.append(...panelTitle("🤔 ¿Alguien lo desafía?", what));
      P.append(h("div", { class: "card-hint" }, h("img", { src: IMG[c.role], alt: B.ROLE_INFO[c.role].name, onclick: () => zoom(IMG[c.role]) })));
      const row = h("div", { class: "grid" });
      B.waitingFor(S).forEach((id) => row.append(h("button", { class: "btn warn", onclick: () => act({ type: "challenge", player: id }) }, "❗ " + S.players[id].name + " desafía")));
      P.append(row, h("button", { class: "btn big ok", onclick: () => act({ type: "passAll" }) }, "✓ Nadie desafía"));
      return;
    }

    if (S.phase === "block") {
      const a = B.ACTIONS[pd.action];
      const actor = S.players[pd.actor].name;
      P.append(...panelTitle("🛡️ ¿Alguien bloquea?", actor + " quiere: " + a.name + (pd.target != null ? " → " + S.players[pd.target].name : "") + "."));
      const row = h("div", { class: "grid" });
      B.waitingFor(S).forEach((id) => a.blockedBy.forEach((r) =>
        row.append(h("button", { class: "btn role-" + r, onclick: () => act({ type: "block", player: id, role: r }) }, "🛡️ " + S.players[id].name, h("small", null, "con " + roleName(r))))));
      P.append(row, h("button", { class: "btn big ok", onclick: () => act({ type: "passAll" }) }, "✓ Nadie bloquea"));
      return;
    }

    if (S.phase === "lose") {
      const l = pd.loss;
      const p = S.players[l.player];
      P.append(...panelTitle("💀 " + p.name + " pierde una planta", "Motivo: " + l.reason + ". Solo " + p.name + " debe mirar: elige cuál pierdes."));
      const row = h("div", { class: "pick" });
      p.cards.forEach((c, i) => { if (!c.lost) row.append(cardEl(c, { show: true, big: true, onclick: () => act({ type: "lose", player: p.id, index: i }) })); });
      P.append(row);
      return;
    }

    if (S.phase === "exchange") {
      const p = S.players[pd.actor];
      const ex = pd.exchange;
      P.append(...panelTitle("🌻 " + p.name + " cambia cartas", "Solo " + p.name + " debe mirar. Elige " + ex.keep + (ex.keep === 1 ? " carta" : " cartas") + " para quedarte."));
      const row = h("div", { class: "pick" });
      ex.options.forEach((r, i) => {
        const on = ui.exSel.includes(i);
        const el = cardEl({ role: r }, { show: true, big: true, onclick: () => {
          if (on) ui.exSel = ui.exSel.filter((x) => x !== i);
          else if (ui.exSel.length < ex.keep) ui.exSel.push(i);
          render();
        } });
        if (on) el.classList.add("sel");
        row.append(el);
      });
      P.append(row, h("button", { class: "btn big ok", disabled: ui.exSel.length !== ex.keep, onclick: () => act({ type: "exchange", player: p.id, keep: ui.exSel }) }, "✓ Quedarme con estas"));
      return;
    }
  }

  function renderLog() {
    const ol = $("log");
    ol.innerHTML = "";
    S.log.slice().reverse().forEach((l) => ol.append(h("li", null, l)));
  }

  function backToSetup() {
    S = null;
    closeAll();
    $("game").hidden = true;
    $("setup").hidden = false;
    renderSetup();
  }

  // ---------- hojas: guía, zoom, menú ----------

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
      "<li><b>En tu turno</b> haces una sola acción: refrescarte (+1), pedir ayuda (+2), exterminar (8 gotas) o usar una habilidad.</li>" +
      "<li><b>Puedes mentir:</b> usa la habilidad de cualquier planta, la tengas o no.</li>" +
      "<li><b>Desafiar:</b> si crees que alguien miente, desafíalo. Si mentía, pierde una planta. Si decía la verdad, pierdes tú una planta y él cambia esa carta por otra del mazo.</li>" +
      "<li><b>Bloquear:</b> también se bloquea diciendo tener una planta, y el bloqueo también se puede desafiar.</li>" +
      "<li><b>Con 11 gotas o más</b> es obligatorio exterminar.</li>" +
      "<li><b>Enredadera:</b> se queda enganchada hasta que la víctima se suelte diciendo tener Tronco, o hasta que su dueño pierda una carta.</li>" +
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
    slides.addEventListener("scroll", () => {
      clearTimeout(slides._t);
      slides._t = setTimeout(markSlide, 60);
    }, { passive: true });
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

  function open(id) { $(id).hidden = false; document.body.classList.add("noscroll"); }
  function closeAll() { ["guide", "zoom", "menu"].forEach((id) => ($(id).hidden = true)); document.body.classList.remove("noscroll"); }
  function zoom(src) { $("zoom").querySelector("img").src = src; open("zoom"); }

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-open-guide]")) { open("guide"); requestAnimationFrame(markSlide); }
    if (e.target.closest("[data-close]")) closeAll();
    if (e.target.classList && e.target.classList.contains("sheet")) closeAll();
    else if (e.target.closest("#zoom")) closeAll();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });

  // ---------- arranque ----------

  $("startBtn").onclick = () => start(false);
  $("menuBtn").onclick = () => { renderLog(); open("menu"); };
  $("newGameBtn").onclick = backToSetup;
  $("showAll").checked = ui.showAll;
  $("showAll").onchange = (e) => { ui.showAll = e.target.checked; store.set("showAll", ui.showAll); render(); };
  buildGuide();
  renderSetup();
})();
