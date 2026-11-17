// Prueba el servidor online real (necesita red). Ejecutar con: node test/server.test.js
const FN = 'https://uyzalwnhuqagxeqseziv.supabase.co/functions/v1/brotes';
const assert = require('assert');
async function call(body) {
  const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) { const e = new Error(j.error || r.status); e.status = r.status; throw e; }
  return j;
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];
(async () => {
  const t0 = Date.now();
  const A = await call({ op: 'create', name: 'Ana' });
  const code = A.room.code;
  console.log('sala', code, 'en', Date.now() - t0, 'ms');
  const L = await call({ op: 'join', code, name: 'Luis' });
  const C = await call({ op: 'join', code, name: 'Coti' });
  const dup = await call({ op: 'join', code, name: 'luis' });
  assert.strictEqual(dup.room.players[3], 'luis 2');
  await assert.rejects(call({ op: 'start', code, token: L.token }), /Solo quien creó/);
  await assert.rejects(call({ op: 'view', code, token: 'falso' }), /No formas parte/);
  const tokens = [A.token, L.token, C.token, dup.token];
  let v = await call({ op: 'start', code, token: A.token });
  assert.strictEqual(v.room.status, 'playing');
  // Cada uno ve solo sus cartas.
  for (let i = 0; i < 4; i++) {
    const w = await call({ op: 'view', code, token: tokens[i] });
    assert.strictEqual(w.seat, i);
    w.state.players.forEach((p, j) => p.cards.forEach((c) => {
      if (j === i) assert.ok(c.role, 'veo mis cartas');
      else if (!c.lost) assert.strictEqual(c.role, null, 'no veo las de otros');
    }));
    assert.strictEqual(w.state.deck.length, 0);
    assert.ok(w.state.deckCount >= 0);
  }
  // No se puede jugar en nombre de otro ni fuera de turno.
  const s0 = (await call({ op: 'view', code, token: A.token })).state;
  const notTurn = (s0.turn + 1) % 4;
  await assert.rejects(call({ op: 'move', code, token: tokens[notTurn], move: { type: 'action', action: 'refrescar' } }), /No es tu turno/);

  // Partida completa con jugadas aleatorias de cada jugador.
  let steps = 0, timeouts = 0;
  while (true) {
    const views = await Promise.all(tokens.map((t) => call({ op: 'view', code, token: t })));
    const s = views[0].state;
    if (s.phase === 'over') { console.log('ganador:', s.players[s.winner].name); break; }
    let moved = false;
    for (let i = 0; i < 4 && !moved; i++) {
      const me = views[i].state;
      const waiting = [];
      if (me.phase === 'action' && me.turn === i) waiting.push('action');
      if (me.phase === 'challenge' && me.pending.responders.includes(i) && !me.pending.passed.includes(i)) waiting.push('challenge');
      if (me.phase === 'block' && me.pending.blockers.includes(i) && !me.pending.passed.includes(i)) waiting.push('block');
      if (me.phase === 'lose' && me.pending.loss.player === i) waiting.push('lose');
      if (me.phase === 'exchange' && me.pending.actor === i) waiting.push('exchange');
      if (!waiting.length) continue;
      let move;
      const p = me.players[i];
      if (me.phase === 'action') {
        const forced = p.water >= 11;
        const alive = me.players.filter((q) => q.status === 'alive' && q.id !== i);
        const opts = forced ? ['exterminar'] : ['refrescar', 'ayuda', 'carnivora', 'tronco', 'girasol', 'enredadera'].concat(p.water >= 3 ? ['cactus'] : []).concat(p.water >= 8 ? ['exterminar'] : []);
        const a = pick(opts);
        move = { type: 'action', action: a, target: pick(alive).id };
      } else if (me.phase === 'challenge') move = Math.random() < 0.2 ? { type: 'challenge' } : { type: 'pass' };
      else if (me.phase === 'block') move = Math.random() < 0.3 ? { type: 'block', role: me.pending.action === 'ayuda' ? 'carnivora' : me.pending.action === 'tronco' ? 'girasol' : me.pending.action === 'cactus' ? 'enredadera' : 'tronco' } : { type: 'pass' };
      else if (me.phase === 'lose') move = { type: 'lose', index: p.cards.findIndex((c) => !c.lost) };
      else move = { type: 'exchange', keep: me.pending.exchange.options.map((_, k) => k).slice(0, me.pending.exchange.keep) };
      await call({ op: 'move', code, token: tokens[i], move });
      moved = true; steps++;
    }
    if (!moved) throw new Error('nadie puede jugar en fase ' + s.phase);
    if (steps === 5) {
      // Prueba el tiempo límite: abre una ventana de desafío y deja que expire.
      const st = (await call({ op: 'view', code, token: A.token })).state;
      if (st.phase === 'challenge') {
        const early = await call({ op: 'move', code, token: A.token, move: { type: 'timeout' } });
        assert.strictEqual(early.state.phase, 'challenge', 'no cierra antes de tiempo');
        timeouts++;
      }
    }
    assert.ok(steps < 600, 'demasiadas jugadas');
  }
  console.log('jugadas', steps, 'pruebas de tiempo', timeouts, 'total', ((Date.now() - t0) / 1000).toFixed(1) + 's');
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });
