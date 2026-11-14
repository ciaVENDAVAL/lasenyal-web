// Mans / Manos / Hands — a hand-rhythm game for La Senyal.
// Based on "Mans — VENDAVAL" v3. Two hands, thumbs outward; each finger = one eighth note.
// Finger up = that hand's instrument plays, folded = rest. Each hand picks its instrument.
// Sections: hands, rhythm, volume (open-palm faders), break (a soloist improvises one bar).
// Everything is scoped to #mans; no storage, no network. The groove lives in the URL hash.
(() => {
  "use strict";
  const root = document.getElementById("mans");
  if (!root) return;
  const T = JSON.parse(root.querySelector(".mans__t").textContent);
  const $ = sel => root.querySelector(`[data-ctl="${sel}"]`);
  const btn = act => root.querySelector(`[data-act="${act}"]`);
  const fmt = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k]);
  const MAX_BARS = 32;  // longest recording

  // one fixed note per instrument for the hands; together they make a Bb major chord
  const BB4 = 466.16;
  const INST = { trumpet: BB4, sax: 349.23 /* F4 */, djembe: 0, voice: 293.66 /* D4 */ };
  const INST_KEYS = ["trumpet", "sax", "djembe", "voice"];
  const INST_CODE = { trumpet: "t", sax: "x", djembe: "d", voice: "v" };
  const CODE_INST = { t: "trumpet", x: "sax", d: "djembe", v: "voice" };
  const iName = k => T["i_" + k] || k;

  /* ---------- rhythms ----------
     len = steps (eighth notes) in the drum cycle. Lane "n" is a key in the translations.
     Pattern chars: "." rest, "x" hit, "X" accent; the conga voice uses m (muted) / o (open) / s (slap). */
  const RHYTHMS = {
    salsa:    { name: "Salsa", len: 16, bpm: 160, clave: true, groups: [0, 4, 8, 12], lanes: [
      { n: "clave", v: "clave", p: "x..x..x...x.x..." },
      { n: "cowbell", v: "cow", p: "X.x.X.x.X.x.X.x." },
      { n: "conga", v: "conga", p: "..mo..so..mo..so" }] },
    son:      { name: "Son", len: 16, bpm: 120, clave: true, groups: [0, 4, 8, 12], lanes: [
      { n: "clave", v: "clave", p: "x..x..x...x.x..." },
      { n: "maracas", v: "shaker", p: "XxXxXxXxXxXxXxXx" },
      { n: "bongo", v: "conga", p: "m.o.m.osm.o.m.os" }] },
    cumbia:   { name: "Cumbia", len: 8, bpm: 96, clave: false, groups: [0, 4], lanes: [
      { n: "kick", v: "kick", p: "X...x..." },
      { n: "conga", v: "conga", p: "..m...mo" },
      { n: "guacharaca", v: "shaker", p: "XxXxXxXx" }] },
    balkan:   { name: "Balkan 7/8", len: 7, bpm: 130, clave: false, groups: [0, 2, 4], lanes: [
      { n: "dum", v: "kick", p: "X...x.." },
      { n: "tek", v: "snare", p: "..x...x" },
      { n: "pulse", v: "hat", p: "x.x.x.." }] },
    flamenco: { name: "Flamenco (rumba)", len: 8, bpm: 108, clave: false, groups: [0, 4], lanes: [
      { n: "cajon_low", v: "kick", p: "X.....x." },
      { n: "cajon_high", v: "snare", p: "..x...x." },
      { n: "palmas", v: "clap", p: "x.xx.x.x" }] },
    funk:     { name: "Funk", len: 8, bpm: 100, clave: false, groups: [0, 4], lanes: [
      { n: "kick", v: "kick", p: "X..x..x." },
      { n: "snare", v: "snare", p: "..X...X." },
      { n: "hihat", v: "hat", p: "XxXxXxXx" }] }
  };
  const rName = k => (T.rhythms && T.rhythms[k]) || RHYTHMS[k].name;

  /* ---------- state ---------- */
  // pattern[0] = left hand, pattern[1] = right hand. Fingers in on-screen order.
  const SETS = [0];   // one pair of hands (the code still supports more: add sets here)
  let pattern = [{ fingers: [1, 0, 1, 1], art: "normal", inst: "trumpet" }, { fingers: [0, 1, 1, 0], art: "normal", inst: "sax" }];
  const handOf = (set, idx) => set * 2 + (idx >> 2);
  let curKey = "salsa", cur = RHYTHMS[curKey], curLanes = [], claveMode = "32", bpm = cur.bpm;
  let drumsOn = true, handsOn = true;
  let playing = false, step = 0, nextTime = 0, timer = null, raf = null, uiQ = [], prevStep = -1;

  // volumes 0..1 (palm faders): drums, each hand, soloist
  const vol = { d: 0.8, h: [0.8, 0.8], s: 0.9 };

  // break: idle -> armed (waits for the next bar) -> solo (one bar) -> idle
  let soloist = "trumpet", brk = "idle", soloNotes = [], soloPos = 0;

  // recording: one entry per step: [note of pair 1, note of pair 2] (+ .brk/.solo during a break)
  let mode = "live";          // live | armed | rec | take
  let take = null;            // {key, clave, bpm, len, steps}
  let takePos = 0;

  const tl = () => cur.len === 16 ? 8 : cur.len;   // steps one bar of hands covers (7 in 7/8)

  function rebuild() {
    curLanes = cur.lanes.map(l => {
      let p = l.p;
      if (cur.clave && claveMode === "23") { const h = cur.len / 2; p = p.slice(h) + p.slice(0, h); }
      return { n: l.n, v: l.v, p };
    });
  }

  /* ---------- audio (all synthesized) ---------- */
  let ctx = null, master = null, noiseBuf = null, bus = null;
  let chDrums = null, chHands = [], chSolo = null;
  function init(ac) {
    ctx = ac;
    const comp = ac.createDynamicsCompressor();
    master = ac.createGain(); master.gain.value = 0.66;
    master.connect(comp).connect(ac.destination);
    const ch = () => { const g = ac.createGain(); g.connect(master); return g; };
    chDrums = ch(); chHands = pattern.map(() => ch()); chSolo = ch();
    applyVol(true);
    noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.25), ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    bus = master;
  }
  function audio() {
    if (!ctx) init(new (window.AudioContext || window.webkitAudioContext)());
    if (ctx.state === "suspended" && ctx.resume) ctx.resume();
    return ctx;
  }
  const gainOf = v => v * v * 1.6;   // fader curve: 0.8 -> about unity
  function applyVol(now) {
    if (!ctx) return;
    const set = (g, v) => now ? (g.gain.value = gainOf(v)) : g.gain.setTargetAtTime(gainOf(v), ctx.currentTime, 0.02);
    set(chDrums, vol.d); chHands.forEach((g, i) => set(g, vol.h[i])); set(chSolo, vol.s);
  }

  function trumpet(t, dur, pitch = INST.trumpet) {
    const ac = ctx;
    const o1 = ac.createOscillator(), o2 = ac.createOscillator();
    o1.type = o2.type = "sawtooth";
    o1.frequency.value = pitch; o2.frequency.value = pitch; o2.detune.value = 6;
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass"; lp.Q.value = 3;
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.exponentialRampToValueAtTime(3400, t + 0.05);
    lp.frequency.exponentialRampToValueAtTime(2100, t + 0.28);
    const g = ac.createGain(), peak = 0.16;
    const a = Math.min(0.018, dur * 0.25), r = Math.min(0.05, dur * 0.35);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.linearRampToValueAtTime(peak * 0.78, t + dur - r); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o1.connect(lp); o2.connect(lp); lp.connect(g).connect(bus);
    if (dur > 0.3) {   // delayed vibrato on long notes
      const lfo = ac.createOscillator(), lg = ac.createGain();
      lfo.frequency.value = 5.5;
      lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(9, t + 0.28);
      lfo.connect(lg); lg.connect(o1.detune); lg.connect(o2.detune);
      lfo.start(t); lfo.stop(t + dur + 0.05);
    }
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  // sax: reedy square + saw, softer attack, a little breath, vibrato on long notes
  function sax(t, dur, f = INST.sax) {
    const ac = ctx;
    const o1 = ac.createOscillator(), o2 = ac.createOscillator();
    o1.type = "square"; o2.type = "sawtooth"; o1.frequency.value = f; o2.frequency.value = f; o2.detune.value = -5;
    const m2 = ac.createGain(); m2.gain.value = 0.6;
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 5;
    lp.frequency.setValueAtTime(900, t); lp.frequency.linearRampToValueAtTime(2200, t + 0.06); lp.frequency.linearRampToValueAtTime(1600, t + 0.3);
    const g = ac.createGain(), peak = 0.13;
    const a = Math.min(0.03, dur * 0.3), r = Math.min(0.06, dur * 0.35);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.linearRampToValueAtTime(peak * 0.8, t + dur - r); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o1.connect(lp); o2.connect(m2).connect(lp); lp.connect(g).connect(bus);
    const n = ac.createBufferSource(); n.buffer = noiseBuf; n.loop = true;   // breath
    const bf = ac.createBiquadFilter(); bf.type = "bandpass"; bf.frequency.value = 2500; bf.Q.value = 0.8;
    const bg = ac.createGain(); bg.gain.setValueAtTime(0.0001, t); bg.gain.linearRampToValueAtTime(0.025, t + 0.02); bg.gain.linearRampToValueAtTime(0.0001, t + Math.min(dur, 0.15));
    n.connect(bf).connect(bg).connect(bus); n.start(t); n.stop(t + dur + 0.05);
    if (dur > 0.3) {
      const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 5;
      lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(12, t + 0.3);
      lfo.connect(lg); lg.connect(o1.detune); lg.connect(o2.detune); lfo.start(t); lfo.stop(t + dur + 0.05);
    }
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  // voice: a sung "ah" (saw through three vowel formants), gentle vibrato
  function voice(t, dur, f = INST.voice) {
    const ac = ctx;
    const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = f;
    const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 5.2;
    lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(dur > 0.3 ? 14 : 4, t + 0.25);
    lfo.connect(lg).connect(o.detune); lfo.start(t); lfo.stop(t + dur + 0.08);
    const g = ac.createGain(), peak = 1.25;
    const a = Math.min(0.045, dur * 0.35), r = Math.min(0.08, dur * 0.4);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.linearRampToValueAtTime(peak * 0.85, t + dur - r); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    [[800, 1, 9], [1150, 0.5, 10], [2900, 0.18, 12]].forEach(([fq, amp, q]) => {
      const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = fq; bp.Q.value = q;
      const fg = ac.createGain(); fg.gain.value = amp;
      o.connect(bp).connect(fg).connect(g);
    });
    g.connect(bus); o.start(t); o.stop(t + dur + 0.08);
  }
  // djembe: slap (bright crack), tone (open), bass (low, centre of the skin)
  function djembe(t, kind = "slap") {
    if (kind === "bass") { tone(t, "sine", 110, 70, 0.75, 0.25); return; }
    if (kind === "tone") { tone(t, "sine", 330, 290, 0.55, 0.16); noiseHit(t, "bandpass", 1200, 1, 0.12, 0.03); return; }
    noiseHit(t, "bandpass", 2600, 1.1, 0.75, 0.06);
    tone(t, "triangle", 420, 330, 0.42, 0.09);
  }
  function playInst(inst, t, dur, f, kind) {
    if (inst === "sax") sax(t, dur, f || INST.sax);
    else if (inst === "voice") voice(t, dur, f || INST.voice);
    else if (inst === "djembe") djembe(t, kind);
    else trumpet(t, dur, f || INST.trumpet);
  }

  function env(g, t, peak, decay) { g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0001, t + decay); }
  function noiseHit(t, type, freq, Q, peak, decay) {
    const n = ctx.createBufferSource(); n.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q;
    const g = ctx.createGain(); env(g, t, peak, decay);
    n.connect(f).connect(g).connect(bus); n.start(t); n.stop(t + decay + 0.05);
  }
  function tone(t, type, f0, f1, peak, decay) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + Math.min(0.12, decay));
    env(g, t, peak, decay); o.connect(g).connect(bus); o.start(t); o.stop(t + decay + 0.04);
  }
  function cowbell(t, accent) {
    const g = ctx.createGain(), bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 800; bp.Q.value = 1;
    [560, 845].forEach(f => { const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = f; o.connect(bp); o.start(t); o.stop(t + 0.2); });
    env(g, t, accent ? 0.2 : 0.11, 0.14); bp.connect(g).connect(bus);
  }
  function conga(t, type) {
    if (type === "s") { noiseHit(t, "bandpass", 1500, 1.2, 0.4, 0.07); return; }
    const f0 = type === "o" ? 250 : 175;
    tone(t, "sine", f0, f0 * 0.8, type === "o" ? 0.42 : 0.32, type === "o" ? 0.22 : 0.12);
  }
  function clap(t, accent) {
    const n = ctx.createBufferSource(); n.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1800; f.Q.value = 1.2;
    const g = ctx.createGain(), pk = accent ? 0.42 : 0.3;
    for (let k = 0; k < 3; k++) { const tk = t + k * 0.011; g.gain.setValueAtTime(pk, tk); g.gain.exponentialRampToValueAtTime(0.05, tk + 0.009); }
    g.gain.setValueAtTime(pk * 0.9, t + 0.033); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    n.connect(f).connect(g).connect(bus); n.start(t); n.stop(t + 0.2);
  }
  function hitVoice(v, ch, t) {
    const acc = ch === "X";
    switch (v) {
      case "clave":  tone(t, "triangle", 2400, 0, 0.32, 0.09); break;
      case "cow":    cowbell(t, acc); break;
      case "conga":  conga(t, ch); break;
      case "kick":   tone(t, "sine", 130, 48, acc ? 0.85 : 0.65, 0.28); break;
      case "snare":  noiseHit(t, "highpass", 1500, 0.7, acc ? 0.45 : 0.32, 0.13); tone(t, "triangle", 200, 0, 0.25, 0.08); break;
      case "hat":    noiseHit(t, "highpass", 7000, 0.7, acc ? 0.2 : 0.11, 0.04); break;
      case "shaker": noiseHit(t, "bandpass", 6000, 0.8, acc ? 0.17 : 0.09, 0.05); break;
      case "clap":   clap(t, acc); break;
    }
  }

  /* ---------- solo: one random bar, Bb major pentatonic so it fits the hands' chord ---------- */
  const PENTA = [0, 2, 4, 7, 9];   // Bb C D F G
  const REG = { trumpet: [-3, 14], sax: [-10, 7], voice: [-12, 5] };   // semitones from Bb4
  const isRoot = s => ((s % 12) + 12) % 12 === 0;
  function makeSolo(inst, len) {
    const notes = new Array(len).fill(null);
    if (inst === "djembe") {
      for (let i = 0; i < len; i++) {
        if (i && Math.random() < 0.22) continue;
        const r = Math.random();
        notes[i] = { inst, kind: i === 0 || r < 0.25 ? "bass" : r < 0.6 ? "tone" : "slap" };
      }
      return notes;
    }
    const [lo, hi] = REG[inst];
    const scale = [];
    for (let s = lo; s <= hi; s++) if (PENTA.includes(((s % 12) + 12) % 12)) scale.push(s);
    let k = Math.max(0, scale.findIndex(isRoot));
    for (let i = 0; i < len; i++) {
      if (i && Math.random() < 0.3) continue;
      k = Math.max(0, Math.min(scale.length - 1, k + Math.floor(Math.random() * 5) - 2));
      notes[i] = { inst, f: BB4 * Math.pow(2, scale[k] / 12), stac: Math.random() < 0.3 };
    }
    // land on a Bb when the last note falls near the end of the bar
    for (let i = len - 1; i >= 0; i--) if (notes[i]) {
      const roots = scale.filter(isRoot);
      if (roots.length && i >= len - 3) notes[i].f = BB4 * Math.pow(2, roots[Math.floor(Math.random() * roots.length)] / 12);
      break;
    }
    notes.forEach((n, i) => { if (!n) return; let g = 1; while (i + g < len && !notes[i + g]) g++; n.gap = g; });
    return notes;
  }
  function playSolo(n, t, sd) {
    if (!n) return;
    bus = chSolo;
    if (n.inst === "djembe") djembe(t, n.kind);
    else playInst(n.inst, t, n.stac ? Math.max(0.08, sd * 0.45) : sd * n.gap * 0.92, n.f);
  }

  /* ---------- scheduler ---------- */
  const stepDur = () => 60 / bpm / 2;
  const noteLen = (art, gap, sd) => art === "staccato" ? Math.max(0.07, sd * 0.35) : art === "sustain" ? sd * gap * 0.97 : sd * 0.72;

  // the note one pair of hands plays at index idx (live), or in the take at pos.
  // Sustain holds until that pair's next note (max 6 steps).
  function liveNote(set, idx) {
    const Tn = tl(), h = handOf(set, idx), p = pattern[h];
    if (!p.fingers[idx & 3]) return null;
    let gap = 6;
    for (let i = 1; i <= 6; i++) { const m = (idx + i) % Tn; if (pattern[handOf(set, m)].fingers[m & 3]) { gap = i; break; } }
    return { art: p.art, inst: p.inst, gap, h };
  }
  function takeNote(set, pos) {
    const st = take.steps[pos];
    if (st.brk) return null;
    const s = st[set];
    if (!s.on) return null;
    let gap = 6;
    for (let i = 1; i <= 6; i++) { const nx = take.steps[(pos + i) % take.steps.length]; if (!nx.brk && nx[set].on) { gap = i; break; } }
    return { art: s.art, inst: s.inst, gap, h: s.h };
  }

  function scheduleStep(n, t) {
    const sd = stepDur(), Tn = tl(), idx = n % Tn;
    const ui = { step: n, time: t };

    // things that start on a bar line
    if (idx === 0) {
      if (mode === "armed") { mode = "rec"; take = { key: curKey, clave: claveMode, bpm, len: Tn, steps: [] }; }
      if (brk === "armed" && mode !== "take") { brk = "solo"; soloNotes = makeSolo(soloist, Tn); soloPos = 0; }
    }

    let inBreak = false, soloNote = null, notes = [];
    if (mode === "take") {
      const st = take.steps[takePos];
      inBreak = !!st.brk; soloNote = st.solo || null;
      if (!inBreak) notes = SETS.map(set => takeNote(set, takePos));
      ui.take = takePos; if (inBreak) ui.solo = st.soloist;
      takePos = (takePos + 1) % take.steps.length;
    } else {
      if (brk === "solo") {
        inBreak = true; soloNote = soloNotes[soloPos]; ui.solo = soloist;
        soloPos++; if (soloPos >= Tn) { brk = "idle"; ui.brkEnd = true; }
      } else notes = SETS.map(set => liveNote(set, idx));
      if (mode === "rec") {
        const entry = SETS.map(set => { const h = handOf(set, idx), p = pattern[h]; return { on: !!p.fingers[idx & 3], art: p.art, inst: p.inst, h }; });
        if (inBreak) Object.assign(entry, { brk: true, solo: soloNote, soloist });
        take.steps.push(entry);
        ui.rec = take.steps.length;
        if (take.steps.length >= MAX_BARS * Tn) ui.recDone = true;
      }
    }

    if (drumsOn && !inBreak) { bus = chDrums; curLanes.forEach(l => { const ch = l.p[n % l.p.length]; if (ch && ch !== ".") hitVoice(l.v, ch, t); }); }
    if (handsOn) notes.forEach(nt => { if (nt) { bus = chHands[nt.h]; playInst(nt.inst, t, noteLen(nt.art, nt.gap, sd)); } });
    if (inBreak) playSolo(soloNote, t, sd);
    bus = master;
    return ui;
  }

  function schedule() {
    const ac = audio();
    while (nextTime < ac.currentTime + 0.12) {
      uiQ.push(scheduleStep(step, nextTime));
      step = (step + 1) % cur.len;
      nextTime += stepDur();
    }
  }
  function uiLoop() {
    if (!playing) return;
    const now = ctx.currentTime;
    while (uiQ.length && uiQ[0].time <= now) {
      const u = uiQ.shift();
      if (u.take !== undefined) showTakeStep(u.take);
      showSolo(u.solo);
      if (u.rec && mode === "rec" && !u.solo) status(fmt(T.st_rec, { n: Math.ceil(u.rec / take.len) }));
      if (u.brkEnd) { syncBreak(); restoreStatus(); }
      setPlayhead(u.step, !!u.solo);
      if (u.recDone && mode === "rec") finishRec();
    }
    raf = requestAnimationFrame(uiLoop);
  }

  /* ---------- hand drawing ---------- */
  const CX = [28, 46, 64, 82];
  const LEN_LEFT = [40, 44, 40, 32];   // index, middle, ring, pinky (left hand, screen order)
  const LEN_RIGHT = [32, 40, 44, 40];  // pinky, ring, middle, index (right hand, screen order)
  function noteGlyph(x, on) {
    if (on) return `<ellipse cx="${x}" cy="22.5" rx="4.6" ry="3.3" transform="rotate(-20 ${x} 22.5)" class="nh"/>` +
      `<line x1="${x + 4.2}" y1="21.5" x2="${x + 4.2}" y2="4" class="stem"/><path d="M${x + 4.2} 4 q6 4 4 11" class="flag"/>`;
    return `<path d="M${x - 2} 14 l5 -4 l-3.5 6 l4.5 4.5" class="rest"/>`;
  }
  function handSVG(h, fingers) {
    const side = h & 1, lens = side === 0 ? LEN_LEFT : LEN_RIGHT;
    let o = `<svg viewBox="0 0 110 118" role="group" aria-label="${side === 0 ? T.left_short : T.right_short}">`;
    [10, 15, 20, 25, 30].forEach(y => { o += `<line x1="6" y1="${y}" x2="104" y2="${y}" class="staffl"/>`; });
    o += `<rect class="palm" x="14" y="70" width="82" height="44" rx="14"/>`;
    o += side === 0
      ? `<rect class="thumb" x="1" y="82" width="13" height="26" rx="6.5" transform="rotate(-28 8 95)"/>`
      : `<rect class="thumb" x="96" y="82" width="13" height="26" rx="6.5" transform="rotate(28 102 95)"/>`;
    o += `<path class="knuckles" d="M22 80 h66" />`;
    for (let i = 0; i < 4; i++) {
      const on = !!fingers[i], c = CX[i], L = lens[i];
      const dis = side === 1 && i === 3 && tl() === 7;
      const num = side * 4 + i + 1;
      o += `<g data-f="${i}" class="${on ? "on" : ""}${dis ? " dis" : ""}" tabindex="${dis ? -1 : 0}" role="button" aria-pressed="${on}"` +
        ` aria-label="${fmt(T.finger, { n: num })}: ${on ? T.on : T.off}"${dis ? ' aria-disabled="true"' : ""}>` +
        noteGlyph(c - 1, on) +
        `<rect class="fing" x="${c - 7}" y="${on ? 84 - L : 66}" width="14" height="${on ? L : 18}" rx="7"/>` +
        `<rect class="hit" x="${c - 9}" y="0" width="18" height="88" fill="transparent"/></g>`;
    }
    return o + `</svg>`;
  }

  /* ---------- hands section: two collapsible pairs ---------- */
  const slotsEl = $("slots"), lanesEl = $("lanes"), laneLabel = $("laneLabel");
  const ARTS = [["normal", T.art_normal], ["sustain", T.art_sustain], ["staccato", T.art_staccato]];
  const slotEls = [];
  SETS.forEach(set => {
    const d = document.createElement(SETS.length > 1 ? "details" : "div");
    d.className = SETS.length > 1 ? "pair" : "pair pair--solo"; if (SETS.length > 1) d.open = true;
    d.innerHTML = (SETS.length > 1 ? `<summary><span>${set === 0 ? T.pair1 : T.pair2}</span><span class="pair__insts"></span></summary>` : "") + `<div class="pair__hands"></div>`;
    slotsEl.appendChild(d);
    [0, 1].forEach(side => {
      const h = set * 2 + side;
      const el = document.createElement("div");
      el.className = "slot"; el.dataset.s = h;
      el.innerHTML = `<div class="cap">${side === 0 ? T.left : T.right}</div>` +
        `<label class="inst"><span class="sr">${T.inst}</span><select data-inst>` +
        INST_KEYS.map(k => `<option value="${k}">${iName(k)}</option>`).join("") + `</select></label>` +
        `<div class="hand"></div>` +
        `<div class="art" role="group">` + ARTS.map(a => `<button type="button" data-art="${a[0]}" aria-pressed="false">${a[1]}</button>`).join("") + `</div>`;
      d.querySelector(".pair__hands").appendChild(el); slotEls.push(el);
    });
  });
  function pairSummary() {
    // the summary names the instruments, so a closed pair still says what it plays
    slotsEl.querySelectorAll(".pair").forEach((d, set) => {
      if (!d.querySelector(".pair__insts")) return;
      d.querySelector(".pair__insts").textContent = iName(pattern[set * 2].inst) + " / " + iName(pattern[set * 2 + 1].inst);
    });
  }
  function renderSlot(h, shown) {
    const p = shown || pattern[h];
    const el = slotEls[h];
    const fa = document.activeElement, focused = fa && el.contains(fa) && fa.dataset ? fa.dataset.f : undefined;
    el.querySelector(".hand").innerHTML = handSVG(h, p.fingers);
    const perc = p.inst === "djembe";   // percussion: playing style does not apply
    el.querySelectorAll("[data-art]").forEach(b => { const s = b.dataset.art === p.art && !perc; b.classList.toggle("sel", s); b.setAttribute("aria-pressed", String(s)); b.disabled = perc; });
    const sel = el.querySelector("select[data-inst]"); if (sel.value !== p.inst) sel.value = p.inst;
    sel.disabled = mode === "take";
    el.dataset.inst = p.inst;
    if (focused !== undefined) { const g = el.querySelector(`g[data-f="${focused}"]`); if (g) g.focus(); }
    if (prevStep >= 0) setPlayhead(prevStep);
  }
  const renderHands = () => { pattern.forEach((p, h) => renderSlot(h)); pairSummary(); renderMixerLabels(); };

  function preview(h, inst, dur) {
    if (!handsOn || playing) return;
    const ac = audio(); bus = chHands[h]; playInst(inst, ac.currentTime + 0.01, dur); bus = master;
  }
  function toggleFinger(h, f) {
    if (mode === "take") return;
    pattern[h].fingers[f] = pattern[h].fingers[f] ? 0 : 1;
    renderSlot(h); saveHash();
    if (pattern[h].fingers[f]) preview(h, pattern[h].inst, 0.3);
  }
  slotsEl.addEventListener("click", e => {
    const slot = e.target.closest(".slot"); if (!slot) return;
    const h = +slot.dataset.s;
    const ab = e.target.closest("[data-art]");
    if (ab) { if (mode === "take") return; pattern[h].art = ab.dataset.art; renderSlot(h); saveHash(); return; }
    const fg = e.target.closest("g[data-f]");
    if (fg && !fg.classList.contains("dis")) toggleFinger(h, +fg.dataset.f);
  });
  slotsEl.addEventListener("change", e => {
    const sel = e.target.closest("select[data-inst]"); if (!sel || mode === "take") return;
    const h = +sel.closest(".slot").dataset.s;
    pattern[h].inst = sel.value; renderSlot(h); pairSummary(); renderMixerLabels(); saveHash();
    preview(h, sel.value, 0.35);
  });
  slotsEl.addEventListener("keydown", e => {
    const fg = e.target.closest && e.target.closest("g[data-f]");
    if (!fg || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault(); e.stopPropagation();
    if (!fg.classList.contains("dis")) toggleFinger(+fg.closest(".slot").dataset.s, +fg.dataset.f);
  });

  /* ---------- rhythm section ---------- */
  function renderLanes() {
    lanesEl.innerHTML = "";
    const groups = new Set(cur.groups);
    laneLabel.textContent = T.groove + " — " + rName(curKey) + " · " + curLanes.map(l => (T.lanes[l.n] || l.n).toLowerCase()).join(" · ");
    curLanes.forEach(l => {
      const row = document.createElement("div");
      row.className = "lane";
      row.style.gridTemplateColumns = `minmax(56px, 88px) repeat(${cur.len}, 1fr)`;
      let h = `<div class="rn">${T.lanes[l.n] || l.n}</div>`;
      for (let n = 0; n < cur.len; n++) {
        const ch = l.p[n], hit = ch !== ".";
        h += `<div class="cell${hit ? " hit" : ""}${ch === "X" || ch === "o" || ch === "s" ? " acc" : ""}${groups.has(n) && n ? " g" : ""}" data-step="${n}"></div>`;
      }
      row.innerHTML = h; lanesEl.appendChild(row);
    });
    if (prevStep >= 0) setPlayhead(prevStep);
  }

  function setPlayhead(n, solo) {
    root.querySelectorAll(".cur, .playing").forEach(x => x.classList.remove("cur", "playing"));
    prevStep = n;
    if (n < 0 || n >= cur.len) return;
    lanesEl.querySelectorAll(`[data-step="${n}"]`).forEach(x => x.classList.add("cur"));
    if (solo) return;   // during a break the hands rest
    const idx = n % tl();
    SETS.forEach(set => {
      const slot = slotEls[handOf(set, idx)];
      slot.classList.add("cur");
      const g = slot.querySelector(`g[data-f="${idx & 3}"]`);
      if (g) g.classList.add("playing");
    });
  }

  /* take playback: the hands show the recorded bar */
  function showTakeStep(pos) {
    if (pos % take.len !== 0) return;
    const bar = take.steps.slice(pos, pos + take.len);
    if (bar[0].brk) return;
    pattern.forEach((_, h) => {
      const set = h >> 1, side = h & 1;
      const fingers = [0, 1, 2, 3].map(f => { const s = bar[side * 4 + f]; return s && s[set].on ? 1 : 0; });
      const s0 = (bar[side * 4] || bar[0])[set];
      renderSlot(h, { fingers, art: s0.art, inst: s0.inst });
    });
    status(fmt(T.st_take, { i: pos / take.len + 1, n: take.steps.length / take.len }));
  }

  /* ---------- volume section: open-palm faders ---------- */
  const mixEl = $("mixer");
  const PALM = `<svg viewBox="0 0 64 64" aria-hidden="true"><g transform="rotate(40 32 32)"><g class="oh"><rect class="oh__f" x="19" y="11" width="6.5" height="24" rx="3.25"/><rect class="oh__f" x="26" y="6" width="6.5" height="29" rx="3.25"/><rect class="oh__f" x="33" y="8" width="6.5" height="27" rx="3.25"/><rect class="oh__f" x="40" y="13" width="6.5" height="22" rx="3.25"/><path class="oh__t" d="M21 47 L10.5 32.5"/><rect class="oh__p" x="17.5" y="27" width="30.5" height="26" rx="9"/><path class="oh__l" d="M23 39 q11 6 22 -1 M25 45 q8 3 15 0 M30 31 v6"/></g></g></svg>`;   // open hand, palm up, diagonal
  const CHANNELS = [{ k: "d", sub: "" }, ...pattern.map((_, h) => ({ k: h, sub: (SETS.length > 1 ? (h >> 1) + 1 + " " : "") + (h & 1 ? "→" : "←") })), { k: "s", sub: "" }];
  const chKey = el => { const k = el.dataset.ch; return /^\d$/.test(k) ? +k : k; };
  const getV = k => k === "d" ? vol.d : k === "s" ? vol.s : vol.h[k];
  const setV = (k, v) => { v = Math.max(0, Math.min(1, Math.round(v * 100) / 100)); if (k === "d") vol.d = v; else if (k === "s") vol.s = v; else vol.h[k] = v; applyVol(); };
  const chName = k => k === "d" ? T.vol_drums : k === "s" ? T.vol_solo + " · " + iName(soloist) : iName(pattern[k].inst);
  CHANNELS.forEach(c => {
    const el = document.createElement("div");
    el.className = "fader"; el.dataset.ch = c.k;
    el.innerHTML = `<div class="fader__track" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-orientation="vertical">` +
      `<div class="fader__fill"></div><div class="fader__palm">${PALM}</div></div>` +
      `<p class="fader__name"></p><p class="fader__sub">${c.sub}</p>`;
    mixEl.appendChild(el);
  });
  function renderMixer() {
    mixEl.querySelectorAll(".fader").forEach(el => {
      const v = getV(chKey(el));
      el.style.setProperty("--v", v);
      const tr = el.querySelector(".fader__track");
      tr.setAttribute("aria-valuenow", Math.round(v * 100)); tr.setAttribute("aria-valuetext", Math.round(v * 100) + "%");
    });
  }
  function renderMixerLabels() {
    mixEl.querySelectorAll(".fader").forEach(el => {
      const k = chKey(el), n = chName(k), sub = el.querySelector(".fader__sub").textContent;
      el.querySelector(".fader__name").textContent = n;
      const where = sub ? " (" + (sub.includes("←") ? T.left_short : T.right_short) + ")" : "";
      el.querySelector(".fader__track").setAttribute("aria-label", fmt(T.vol_of, { n }) + where);
    });
  }
  mixEl.addEventListener("pointerdown", e => {
    const tr = e.target.closest(".fader__track"); if (!tr) return;
    e.preventDefault(); tr.focus();
    const k = chKey(tr.parentElement);
    const move = ev => {
      const r = tr.getBoundingClientRect(), pad = 26;
      setV(k, 1 - (ev.clientY - r.top - pad) / (r.height - pad * 2)); renderMixer();
    };
    move(e);
    try { tr.setPointerCapture(e.pointerId); } catch (_) {}
    const up = () => { tr.removeEventListener("pointermove", move); tr.removeEventListener("pointerup", up); tr.removeEventListener("pointercancel", up); saveHash(); };
    tr.addEventListener("pointermove", move); tr.addEventListener("pointerup", up); tr.addEventListener("pointercancel", up);
  });
  mixEl.addEventListener("keydown", e => {
    const tr = e.target.closest(".fader__track"); if (!tr) return;
    const k = chKey(tr.parentElement), v = getV(k);
    const d = { ArrowUp: .05, ArrowRight: .05, ArrowDown: -.05, ArrowLeft: -.05, PageUp: .2, PageDown: -.2 }[e.key];
    if (d !== undefined) setV(k, v + d); else if (e.key === "Home") setV(k, 0); else if (e.key === "End") setV(k, 1); else return;
    e.preventDefault(); renderMixer(); saveHash();
  });

  /* ---------- break section ---------- */
  const chopBtn = btn("break");
  const soloBtns = [...root.querySelectorAll("[data-solo]")];
  function syncSoloist() {
    soloBtns.forEach(b => { const on = b.dataset.solo === soloist; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; });
    renderMixerLabels();
  }
  soloBtns.forEach(b => b.addEventListener("click", () => {
    soloist = b.dataset.solo; syncSoloist(); saveHash();
    if (!playing) { const ac = audio(); bus = chSolo; playInst(soloist, ac.currentTime + 0.01, 0.3, 0, "slap"); bus = master; }
  }));
  root.querySelector(".brk__insts").addEventListener("keydown", e => {   // radio-group arrows
    const i = soloBtns.indexOf(document.activeElement); if (i < 0) return;
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!d) return;
    e.preventDefault(); const b = soloBtns[(i + d + soloBtns.length) % soloBtns.length]; b.focus(); b.click();
  });
  function syncBreak() {
    chopBtn.classList.toggle("is-armed", brk === "armed");
    chopBtn.classList.toggle("is-solo", brk === "solo");
    chopBtn.disabled = mode === "take";
  }
  function showSolo(inst) {
    soloBtns.forEach(b => b.classList.toggle("is-playing", !!inst && b.dataset.solo === inst));
    root.classList.toggle("is-break", !!inst);
    chopBtn.classList.toggle("is-solo", !!inst);
    if (inst) { chopBtn.classList.remove("is-armed"); status(fmt(T.st_solo, { inst: iName(inst) })); }
  }
  chopBtn.addEventListener("click", () => {
    if (mode === "take" || brk !== "idle") return;
    brk = "armed"; syncBreak(); status(T.st_break);
    if (!playing) start();
  });

  /* ---------- transport ---------- */
  const statusEl = root.querySelector(".mans__status");
  const status = s => { if (statusEl.textContent !== s) statusEl.textContent = s; };
  const setBtn = (act, on, label, icon) => {
    const b = btn(act); b.setAttribute("aria-pressed", String(on)); b.classList.toggle("on", on);
    if (label) b.querySelector(".mb__t").textContent = label;
    if (icon) b.querySelector(".mb__i").textContent = icon;
  };
  function syncButtons() {
    const live = playing && mode !== "take";
    setBtn("play", live, live ? T.stop : T.play, live ? "■" : "▶");
    setBtn("rec", mode === "rec" || mode === "armed", mode === "rec" || mode === "armed" ? T.rec_stop : T.rec, "●");
    setBtn("take", mode === "take", mode === "take" ? T.take_stop : T.take, mode === "take" ? "■" : "▷");
    btn("take").disabled = !(take && take.steps.length) || mode === "rec" || mode === "armed";
    root.classList.toggle("is-take", mode === "take");
    root.classList.toggle("is-rec", mode === "rec" || mode === "armed");
    syncBreak();
    if (typeof syncFloat === "function") syncFloat();
  }
  function haveStatus() {
    status(take && take.steps.length ? fmt(T.st_have, { n: Math.ceil(take.steps.length / take.len) }) : T.st_none);
  }
  function restoreStatus() {
    if (mode === "rec" && take) status(fmt(T.st_rec, { n: Math.ceil(take.steps.length / take.len) }));
    else if (mode !== "take") haveStatus();
  }

  function start() {
    const ac = audio();
    playing = true; step = 0; uiQ = []; takePos = 0;
    nextTime = ac.currentTime + 0.06;
    schedule(); timer = setInterval(schedule, 25); raf = requestAnimationFrame(uiLoop);
    syncButtons();
  }
  function stop() {
    if (mode === "rec" || mode === "armed") finishRec();
    const wasTake = mode === "take";
    playing = false; clearInterval(timer); cancelAnimationFrame(raf); uiQ = [];
    mode = "live"; brk = "idle"; showSolo(null);
    if (wasTake) renderHands();
    setPlayhead(-1); syncButtons(); haveStatus();
  }
  function finishRec() {
    if (mode === "armed") { mode = "live"; }
    else if (mode === "rec") {
      const whole = Math.floor(take.steps.length / take.len) * take.len;   // keep whole bars only
      take.steps = take.steps.slice(0, whole || take.steps.length);
      mode = "live";
    }
    haveStatus(); syncButtons();
  }

  btn("play").addEventListener("click", () => {
    if (playing && mode !== "take") stop();
    else { if (mode === "take") stop(); start(); }
  });
  btn("rec").addEventListener("click", () => {
    if (mode === "rec" || mode === "armed") { finishRec(); return; }
    if (mode === "take") stop();
    mode = "armed"; status(T.st_armed);
    if (!playing) start(); else syncButtons();
  });
  btn("take").addEventListener("click", () => {
    if (mode === "take") { stop(); return; }
    if (!take || !take.steps.length) return;
    if (playing) stop();
    // play it back with the rhythm, clave and tempo it was recorded with
    if (curKey !== take.key) { rhythmSel.value = take.key; applyRhythm(take.key, false); }
    claveMode = take.clave; claveSel.value = claveMode; rebuild(); renderLanes();
    setTempo(take.bpm);
    mode = "take"; start();
  });

  const tempo = $("tempo"), tempoOut = $("tempoOut");
  function setTempo(v) { bpm = v; tempo.value = v; tempoOut.textContent = v + " BPM"; }
  tempo.addEventListener("input", () => { setTempo(+tempo.value); saveHash(); });

  const rhythmSel = $("rhythm"), claveSel = $("clave"), claveWrap = $("claveWrap");
  Object.keys(RHYTHMS).forEach(k => { const o = document.createElement("option"); o.value = k; o.textContent = rName(k); rhythmSel.appendChild(o); });
  function applyRhythm(k, resetTempo = true) {
    curKey = k; cur = RHYTHMS[k];
    if (resetTempo) setTempo(cur.bpm);
    claveWrap.hidden = !cur.clave;
    rebuild();
    if (playing) { step = 0; uiQ = []; }
    prevStep = -1; setPlayhead(-1);
    renderLanes(); renderHands();
  }
  rhythmSel.addEventListener("change", () => {
    if (mode !== "live" || brk !== "idle") stop();
    applyRhythm(rhythmSel.value); saveHash();
  });
  claveSel.addEventListener("change", () => { claveMode = claveSel.value; rebuild(); renderLanes(); saveHash(); });

  btn("drums").addEventListener("click", () => { drumsOn = !drumsOn; setBtn("drums", drumsOn); });
  btn("hands").addEventListener("click", () => { handsOn = !handsOn; setBtn("hands", handsOn); });
  btn("clear").addEventListener("click", () => { if (mode === "take") return; pattern.forEach(p => { p.fingers = [0, 0, 0, 0]; }); renderHands(); saveHash(); });
  btn("share").addEventListener("click", async () => {
    saveHash();
    const b = btn("share"), label = T.share;
    try { await navigator.clipboard.writeText(location.href); b.textContent = T.copied; }
    catch (e) { b.textContent = location.hash; }
    setTimeout(() => { b.textContent = label; }, 1800);
  });

  // Space = play / stop, only when nothing else on the page wants the key
  document.addEventListener("keydown", e => {
    if (e.key !== " " || e.defaultPrevented) return;
    const t = e.target;
    if (t.closest && t.closest("a, button, input, select, textarea, summary, [contenteditable], [role=button], [role=slider], .menu, .a11y")) return;
    if (t !== document.body && !root.contains(t)) return;
    const r = root.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return;   // game not on screen: let the page scroll
    e.preventDefault(); btn("play").click();
  });
  addEventListener("pagehide", () => { if (playing) stop(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && playing) stop(); });
  root.addEventListener("pointerdown", () => audio(), { once: true });

  /* ---------- share link ----------
     #r=salsa&t=160&c=32&f=8 digits&a=2 styles (n/s/t)&i=2 instruments (t/x/d/v)
      &v=volumes 0-100 (drums, each hand, soloist)&s=soloist   (older, longer links still open) */
  const ART_CODE = { normal: "n", sustain: "s", staccato: "t" }, CODE_ART = { n: "normal", s: "sustain", t: "staccato" };
  function saveHash() {
    const f = pattern.map(p => p.fingers.join("")).join("");
    const a = pattern.map(p => ART_CODE[p.art]).join("");
    const i = pattern.map(p => INST_CODE[p.inst]).join("");
    const v = [vol.d, ...vol.h, vol.s].map(x => Math.round(x * 100)).join(".");
    const h = `#r=${curKey}&t=${bpm}&c=${claveMode}&f=${f}&a=${a}&i=${i}&v=${v}&s=${INST_CODE[soloist]}`;
    if (location.hash !== h) history.replaceState(null, "", h);
  }
  function loadHash() {
    const q = new URLSearchParams(location.hash.slice(1));
    if (q.get("r") && RHYTHMS[q.get("r")]) { curKey = q.get("r"); cur = RHYTHMS[curKey]; bpm = cur.bpm; }
    const t = +q.get("t"); if (t >= 60 && t <= 240) bpm = t;
    if (q.get("c") === "23") claveMode = "23";
    const f = q.get("f");
    if (f && /^[01]{8,16}$/.test(f)) pattern.forEach((p, h) => { if (h * 4 + 4 <= f.length) p.fingers = f.slice(h * 4, h * 4 + 4).split("").map(Number); });
    const a = q.get("a"); if (a && /^[nst]{2,4}$/.test(a)) pattern.forEach((p, h) => { if (a[h]) p.art = CODE_ART[a[h]]; });
    const i = q.get("i"); if (i && /^[txdv]{2,4}$/.test(i)) pattern.forEach((p, h) => { if (i[h]) p.inst = CODE_INST[i[h]]; });
    const v = (q.get("v") || "").split(".").map(Number);
    if (v.length >= 3 && v.every(x => x >= 0 && x <= 100)) { vol.d = v[0] / 100; pattern.forEach((_, h) => { if (h + 1 < v.length - 1) vol.h[h] = v[h + 1] / 100; }); vol.s = v[v.length - 1] / 100; }
    if (CODE_INST[q.get("s")]) soloist = CODE_INST[q.get("s")];
  }

  /* ---------- floating play / record / stop (shows when the main bar scrolls away) ---------- */
  const fl = root.querySelector(".mans__float");
  const mainBar = root.querySelector(".mans__transport");
  if (fl && "IntersectionObserver" in window) {
    let barOut = false, gameIn = true;
    const sync = () => fl.classList.toggle("is-on", barOut && gameIn);
    new IntersectionObserver(es => { barOut = !es[0].isIntersecting && es[0].boundingClientRect.top < 0; sync(); }).observe(mainBar);
    new IntersectionObserver(es => { gameIn = es[0].isIntersecting; sync(); }, { rootMargin: "-120px 0px 0px 0px" }).observe(root);
  }
  if (fl) {
    fl.addEventListener("click", e => {
      const b = e.target.closest("[data-fl]"); if (!b) return;
      const a = b.dataset.fl;
      if (a === "play") { if (!(playing && mode !== "take")) btn("play").click(); }
      else if (a === "rec") btn("rec").click();
      else if (a === "stop") { if (playing) stop(); }
    });
  }
  function syncFloat() {
    if (!fl) return;
    fl.querySelector('[data-fl="play"]').classList.toggle("on", playing && mode !== "take");
    fl.querySelector('[data-fl="rec"]').classList.toggle("on", mode === "rec" || mode === "armed");
    fl.querySelector('[data-fl="stop"]').disabled = !playing;
    fl.querySelector(".mans__float-st").textContent = statusEl.textContent;
  }
  new MutationObserver(syncFloat).observe(statusEl, { childList: true, characterData: true, subtree: true });

  /* ---------- go ---------- */
  loadHash();
  rhythmSel.value = curKey; claveSel.value = claveMode;
  claveWrap.hidden = !cur.clave;
  rebuild(); setTempo(bpm); renderLanes(); renderHands(); renderMixer(); renderMixerLabels(); syncSoloist(); syncButtons(); haveStatus();

  // test hook (only with ?mans-test): render offline to check levels
  if (/[?&]mans-test\b/.test(location.search)) {
    window.__mansRender = async (key, seconds, opts = {}) => {
      const off = new OfflineAudioContext(1, Math.ceil(44100 * seconds), 44100);
      const keep = { ctx, master, noiseBuf, chDrums, chHands, chSolo, drumsOn, handsOn, curKey, bpm, soloist, brk, pattern: JSON.parse(JSON.stringify(pattern)) };
      init(off); applyRhythm(key); drumsOn = opts.drums !== false; handsOn = opts.hands !== false;
      if (opts.hands4) opts.hands4.forEach((o, h) => Object.assign(pattern[h], o));
      if (opts.solo) { soloist = opts.solo; brk = "armed"; }
      let s = 0, tt = 0.05;
      while (tt < seconds - 0.5) { scheduleStep(s, tt); if (opts.solo && brk === "idle" && opts.soloLoop) brk = "armed"; s = (s + 1) % cur.len; tt += stepDur(); }
      const buf = await off.startRendering(), d = buf.getChannelData(0);
      let pk = 0, sq = 0; for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; sq += d[i] * d[i]; }
      ({ ctx, master, noiseBuf, chDrums, chHands, chSolo, drumsOn, handsOn, soloist, brk } = keep); pattern = keep.pattern; applyRhythm(keep.curKey); setTempo(keep.bpm);
      return { peak: +pk.toFixed(3), rms: +Math.sqrt(sq / d.length).toFixed(4) };
    };
    window.__mansSolo = (inst, len) => makeSolo(inst, len);
  }
})();
