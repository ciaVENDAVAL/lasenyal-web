// Mans / Manos / Hands — a hand-rhythm game for La Senyal.
// Based on "Mans — VENDAVAL" v3. Two pairs of hands, thumbs outward; each finger = one eighth note.
// Finger up = that hand's instrument plays, folded = rest. Both pairs play the same bar together. Everything is scoped to #mans; no storage,
// no network. The current groove lives in the URL hash so it can be shared.
(() => {
  "use strict";
  const root = document.getElementById("mans");
  if (!root) return;
  const T = JSON.parse(root.querySelector(".mans__t").textContent);
  const $ = sel => root.querySelector(`[data-ctl="${sel}"]`);
  const btn = act => root.querySelector(`[data-act="${act}"]`);
  const fmt = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k]);

  // one fixed note per instrument; together they make a Bb major chord
  const INST = { trumpet: 466.16 /* Bb4 */, sax: 349.23 /* F4 */, djembe: 0, voice: 293.66 /* D4 */ };
  const INST_KEYS = ["trumpet", "sax", "djembe", "voice"];
  const INST_CODE = { trumpet: "t", sax: "x", djembe: "d", voice: "v" };
  const CODE_INST = { t: "trumpet", x: "sax", d: "djembe", v: "voice" };
  const MAX_BARS = 32;  // longest recording

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
  // pattern[0..1] = first pair (left, right), pattern[2..3] = second pair. Fingers in on-screen order.
  let pattern = [
    { fingers: [1, 0, 1, 1], art: "normal", inst: "trumpet" }, { fingers: [0, 1, 1, 0], art: "normal", inst: "trumpet" },
    { fingers: [1, 1, 0, 1], art: "normal", inst: "djembe" },  { fingers: [0, 1, 0, 1], art: "sustain", inst: "sax" }];
  const handOf = (set, idx) => set * 2 + (idx >> 2);
  let curKey = "salsa", cur = RHYTHMS[curKey], curLanes = [], claveMode = "32", bpm = cur.bpm;
  let drumsOn = true, handsOn = true;
  let playing = false, step = 0, nextTime = 0, timer = null, raf = null, uiQ = [], prevStep = -1;

  // recording: one entry per step: [note of pair 1, note of pair 2], each {on, art, inst}. A "take" replays it.
  let mode = "live";          // live | armed | rec | take
  let take = null;            // {key, clave, bpm, len, steps:[[{on,art,inst},{on,art,inst}]]}
  let recPos = 0, takePos = 0;

  const tl = () => cur.len === 16 ? 8 : cur.len;   // steps the two hands cover (7 in 7/8)

  function rebuild() {
    curLanes = cur.lanes.map(l => {
      let p = l.p;
      if (cur.clave && claveMode === "23") { const h = cur.len / 2; p = p.slice(h) + p.slice(0, h); }
      return { n: l.n, v: l.v, p };
    });
  }

  /* ---------- audio (all synthesized) ---------- */
  let ctx = null, master = null, noiseBuf = null;
  function init(ac) {
    ctx = ac;
    const comp = ac.createDynamicsCompressor();
    master = ac.createGain(); master.gain.value = 0.66;
    master.connect(comp).connect(ac.destination);
    noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.25), ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function audio() {
    if (!ctx) init(new (window.AudioContext || window.webkitAudioContext)());
    if (ctx.state === "suspended" && ctx.resume) ctx.resume();
    return ctx;
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
    const g = ac.createGain();
    const peak = 0.16;
    const a = Math.min(0.018, dur * 0.25), r = Math.min(0.05, dur * 0.35);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.linearRampToValueAtTime(peak * 0.78, t + dur - r);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o1.connect(lp); o2.connect(lp); lp.connect(g).connect(master);
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
  function sax(t, dur) {
    const ac = ctx, f = INST.sax;
    const o1 = ac.createOscillator(), o2 = ac.createOscillator();
    o1.type = "square"; o2.type = "sawtooth"; o1.frequency.value = f; o2.frequency.value = f; o2.detune.value = -5;
    const m2 = ac.createGain(); m2.gain.value = 0.6;
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 5;
    lp.frequency.setValueAtTime(900, t); lp.frequency.linearRampToValueAtTime(2200, t + 0.06); lp.frequency.linearRampToValueAtTime(1600, t + 0.3);
    const g = ac.createGain(), peak = 0.13;
    const a = Math.min(0.03, dur * 0.3), r = Math.min(0.06, dur * 0.35);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.linearRampToValueAtTime(peak * 0.8, t + dur - r); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o1.connect(lp); o2.connect(m2).connect(lp); lp.connect(g).connect(master);
    // breath
    const n = ac.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
    const bf = ac.createBiquadFilter(); bf.type = "bandpass"; bf.frequency.value = 2500; bf.Q.value = 0.8;
    const bg = ac.createGain(); bg.gain.setValueAtTime(0.0001, t); bg.gain.linearRampToValueAtTime(0.025, t + 0.02); bg.gain.linearRampToValueAtTime(0.0001, t + Math.min(dur, 0.15));
    n.connect(bf).connect(bg).connect(master); n.start(t); n.stop(t + dur + 0.05);
    if (dur > 0.3) {
      const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 5;
      lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(12, t + 0.3);
      lfo.connect(lg); lg.connect(o1.detune); lg.connect(o2.detune); lfo.start(t); lfo.stop(t + dur + 0.05);
    }
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  // voice: a sung "ah" (saw through three vowel formants), gentle vibrato
  function voice(t, dur) {
    const ac = ctx, f = INST.voice;
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
    g.connect(master); o.start(t); o.stop(t + dur + 0.08);
  }
  // djembe slap: bright crack + short ringing skin
  function djembe(t) {
    noiseHit(t, "bandpass", 2600, 1.1, 0.75, 0.06);
    tone(t, "triangle", 420, 330, 0.42, 0.09);
  }
  function playInst(inst, t, dur) {
    if (inst === "sax") sax(t, dur);
    else if (inst === "voice") voice(t, dur);
    else if (inst === "djembe") djembe(t);
    else trumpet(t, dur);
  }

  function env(g, t, peak, decay) { g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0001, t + decay); }
  function noiseHit(t, type, freq, Q, peak, decay) {
    const n = ctx.createBufferSource(); n.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q;
    const g = ctx.createGain(); env(g, t, peak, decay);
    n.connect(f).connect(g).connect(master); n.start(t); n.stop(t + decay + 0.05);
  }
  function tone(t, type, f0, f1, peak, decay) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + Math.min(0.12, decay));
    env(g, t, peak, decay); o.connect(g).connect(master); o.start(t); o.stop(t + decay + 0.04);
  }
  function cowbell(t, accent) {
    const g = ctx.createGain(), bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 800; bp.Q.value = 1;
    [560, 845].forEach(f => { const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = f; o.connect(bp); o.start(t); o.stop(t + 0.2); });
    env(g, t, accent ? 0.2 : 0.11, 0.14); bp.connect(g).connect(master);
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
    n.connect(f).connect(g).connect(master); n.start(t); n.stop(t + 0.2);
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

  /* ---------- scheduler ---------- */
  const stepDur = () => 60 / bpm / 2;
  const noteLen = (art, gap, sd) => art === "staccato" ? Math.max(0.07, sd * 0.35) : art === "sustain" ? sd * gap * 0.97 : sd * 0.72;

  // which note a pair of hands plays at index idx: live hands, or the recorded take.
  // Sustain holds until that pair's next note (max 6 steps).
  function liveNote(set, idx) {
    const Tn = tl(), p = pattern[handOf(set, idx)];
    if (!p.fingers[idx & 3]) return null;
    let gap = 6;
    for (let i = 1; i <= 6; i++) { const m = (idx + i) % Tn; if (pattern[handOf(set, m)].fingers[m & 3]) { gap = i; break; } }
    return { art: p.art, inst: p.inst, gap };
  }
  function takeNote(set, pos) {
    const s = take.steps[pos][set];
    if (!s.on) return null;
    let gap = 6;
    for (let i = 1; i <= 6; i++) { if (take.steps[(pos + i) % take.steps.length][set].on) { gap = i; break; } }
    return { art: s.art, inst: s.inst, gap };
  }

  function scheduleStep(n, t) {
    const sd = stepDur(), Tn = tl(), idx = n % Tn;
    if (drumsOn) curLanes.forEach(l => { const ch = l.p[n % l.p.length]; if (ch && ch !== ".") hitVoice(l.v, ch, t); });

    // start recording on a bar line
    if (mode === "armed" && idx === 0) { mode = "rec"; recPos = 0; take = { key: curKey, clave: claveMode, bpm, len: Tn, steps: [] }; }
    let notes = [null, null], ui = { step: n, time: t };
    if (mode === "take") {
      notes = [takeNote(0, takePos), takeNote(1, takePos)];
      ui.take = takePos; takePos = (takePos + 1) % take.steps.length;
    } else {
      notes = [liveNote(0, idx), liveNote(1, idx)];
      if (mode === "rec") {
        take.steps.push([0, 1].map(set => { const p = pattern[handOf(set, idx)]; return { on: !!p.fingers[idx & 3], art: p.art, inst: p.inst }; }));
        ui.rec = take.steps.length;
        if (take.steps.length >= MAX_BARS * Tn) ui.recDone = true;
      }
    }
    if (handsOn) notes.forEach(nt => { if (nt) playInst(nt.inst, t, noteLen(nt.art, nt.gap, sd)); });
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
      if (u.rec && mode === "rec") status(fmt(T.st_rec, { n: Math.ceil(u.rec / take.len) }));
      setPlayhead(u.step);
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
    const lens = (h & 1) === 0 ? LEN_LEFT : LEN_RIGHT;
    const side = h & 1;
    let o = `<svg viewBox="0 0 110 118" role="group" aria-label="${(h < 2 ? T.pair1 : T.pair2) + " · " + (side === 0 ? T.left_short : T.right_short)}">`;
    [10, 15, 20, 25, 30].forEach(y => { o += `<line x1="6" y1="${y}" x2="104" y2="${y}" class="staffl"/>`; });
    o += `<rect class="palm" x="14" y="70" width="82" height="44" rx="14"/>`;
    o += side === 0
      ? `<rect class="thumb" x="1" y="82" width="13" height="26" rx="6.5" transform="rotate(-28 8 95)"/>`
      : `<rect class="thumb" x="96" y="82" width="13" height="26" rx="6.5" transform="rotate(28 102 95)"/>`;
    o += `<path class="knuckles" d="M22 80 h66" />`;
    for (let i = 0; i < 4; i++) {
      const on = !!fingers[i], c = CX[i], L = lens[i];
      const dis = (h & 1) === 1 && i === 3 && tl() === 7;
      const num = (h & 1) * 4 + i + 1;
      o += `<g data-f="${i}" class="${on ? "on" : ""}${dis ? " dis" : ""}" tabindex="${dis ? -1 : 0}" role="button" aria-pressed="${on}"` +
        ` aria-label="${fmt(T.finger, { n: num })}: ${on ? T.on : T.off}"${dis ? ' aria-disabled="true"' : ""}>` +
        noteGlyph(c - 1, on) +
        `<rect class="fing" x="${c - 7}" y="${on ? 84 - L : 66}" width="14" height="${on ? L : 18}" rx="7"/>` +
        `<rect class="hit" x="${c - 9}" y="0" width="18" height="88" fill="transparent"/></g>`;
    }
    return o + `</svg>`;
  }

  /* ---------- build UI ---------- */
  const slotsEl = $("slots"), lanesEl = $("lanes"), laneLabel = $("laneLabel");
  const ARTS = [["normal", T.art_normal], ["sustain", T.art_sustain], ["staccato", T.art_staccato]];
  const slotEls = [];
  pattern.forEach((p, h) => {
    if ((h & 1) === 0) {
      const lab = document.createElement("p");
      lab.className = "pair"; lab.textContent = h === 0 ? T.pair1 : T.pair2;
      slotsEl.appendChild(lab);
    }
    const el = document.createElement("div");
    el.className = "slot"; el.dataset.s = h;
    el.innerHTML = `<div class="cap">${(h & 1) === 0 ? T.left : T.right}</div>` +
      `<label class="inst"><span class="sr">${T.inst}</span><select data-inst>` +
      INST_KEYS.map(k => `<option value="${k}">${T["i_" + k]}</option>`).join("") + `</select></label>` +
      `<div class="hand"></div>` +
      `<div class="art" role="group">` + ARTS.map(a => `<button type="button" data-art="${a[0]}" aria-pressed="false">${a[1]}</button>`).join("") + `</div>`;
    slotsEl.appendChild(el); slotEls.push(el);
  });
  function renderSlot(h, shown) {
    const p = shown || pattern[h];
    const el = slotEls[h];
    const focused = document.activeElement && el.contains(document.activeElement) && document.activeElement.dataset.f;
    el.querySelector(".hand").innerHTML = handSVG(h, p.fingers);
    const perc = p.inst === "djembe";   // percussion: playing style does not apply
    el.querySelectorAll("[data-art]").forEach(b => { const s = b.dataset.art === p.art; b.classList.toggle("sel", s && !perc); b.setAttribute("aria-pressed", String(s && !perc)); b.disabled = perc; });
    const sel = el.querySelector("[data-inst]"); if (sel.value !== p.inst) sel.value = p.inst;
    sel.disabled = mode === "take";
    el.dataset.inst = p.inst;
    if (focused !== undefined && focused !== false && focused !== null) { const g = el.querySelector(`g[data-f="${focused}"]`); if (g) g.focus(); }
    if (prevStep >= 0) setPlayhead(prevStep);
  }
  const renderHands = () => pattern.forEach((p, h) => renderSlot(h));

  function toggleFinger(h, f) {
    if (mode === "take") return;
    pattern[h].fingers[f] = pattern[h].fingers[f] ? 0 : 1;
    renderSlot(h); saveHash();
    if (pattern[h].fingers[f] && handsOn && !playing) { const ac = audio(); playInst(pattern[h].inst, ac.currentTime + 0.01, 0.3); }
  }
  slotsEl.addEventListener("click", e => {
    const slot = e.target.closest(".slot"); if (!slot) return;
    const h = +slot.dataset.s;
    const ab = e.target.closest("[data-art]");
    if (ab) { if (mode === "take") return; pattern[h].art = ab.dataset.art; renderSlot(h); saveHash(); return; }
    const fg = e.target.closest("[data-f]");
    if (fg && !fg.classList.contains("dis")) toggleFinger(h, +fg.dataset.f);
  });
  slotsEl.addEventListener("change", e => {
    const sel = e.target.closest("[data-inst]"); if (!sel || mode === "take") return;
    const h = +sel.closest(".slot").dataset.s;
    pattern[h].inst = sel.value; renderSlot(h); saveHash();
    if (handsOn && !playing) { const ac = audio(); playInst(sel.value, ac.currentTime + 0.01, 0.35); }
  });
  slotsEl.addEventListener("keydown", e => {
    const fg = e.target.closest && e.target.closest("[data-f]");
    if (!fg || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault(); e.stopPropagation();
    if (!fg.classList.contains("dis")) toggleFinger(+fg.closest(".slot").dataset.s, +fg.dataset.f);
  });

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

  function setPlayhead(n) {
    root.querySelectorAll(".cur, .playing").forEach(x => x.classList.remove("cur", "playing"));
    prevStep = n;
    if (n < 0 || n >= cur.len) return;
    lanesEl.querySelectorAll(`[data-step="${n}"]`).forEach(x => x.classList.add("cur"));
    const idx = n % tl();
    [0, 1].forEach(set => {
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
    [0, 1, 2, 3].forEach(h => {
      const set = h >> 1, side = h & 1;
      const fingers = [0, 1, 2, 3].map(f => { const s = bar[side * 4 + f]; return s && s[set].on ? 1 : 0; });
      const s0 = (bar[side * 4] || bar[0])[set];
      renderSlot(h, { fingers, art: s0.art, inst: s0.inst });
    });
    const bars = take.steps.length / take.len;
    status(fmt(T.st_take, { i: pos / take.len + 1, n: bars }));
  }

  /* ---------- controls ---------- */
  const statusEl = root.querySelector(".mans__status");
  const status = s => { if (statusEl.textContent !== s) statusEl.textContent = s; };
  const setBtn = (act, on, label, icon) => {
    const b = btn(act); b.setAttribute("aria-pressed", String(on)); b.classList.toggle("on", on);
    if (label) b.querySelector(".mb__t").textContent = label;
    if (icon) b.querySelector(".mb__i").textContent = icon;
  };
  function syncButtons() {
    setBtn("play", playing && mode !== "take", playing && mode !== "take" ? T.stop : T.play, playing && mode !== "take" ? "■" : "▶");
    setBtn("rec", mode === "rec" || mode === "armed", mode === "rec" || mode === "armed" ? T.rec_stop : T.rec, "●");
    setBtn("take", mode === "take", mode === "take" ? T.take_stop : T.take, mode === "take" ? "■" : "▷");
    btn("take").disabled = !(take && take.steps.length) || mode === "rec" || mode === "armed";
    root.classList.toggle("is-take", mode === "take");
    root.classList.toggle("is-rec", mode === "rec" || mode === "armed");
  }
  function haveStatus() {
    status(take && take.steps.length ? fmt(T.st_have, { n: Math.ceil(take.steps.length / take.len) }) : T.st_none);
  }

  function start() {
    const ac = audio();
    playing = true; step = 0; uiQ = []; takePos = 0;
    nextTime = ac.currentTime + 0.06;
    schedule(); timer = setInterval(schedule, 25); raf = requestAnimationFrame(uiLoop);
    syncButtons();
  }
  function stop() {
    if (mode === "rec" || mode === "armed") finishRec(true);
    const wasTake = mode === "take";
    playing = false; clearInterval(timer); cancelAnimationFrame(raf); uiQ = [];
    mode = "live";
    if (wasTake) renderHands();
    setPlayhead(-1); syncButtons();
    if (wasTake) haveStatus();
  }
  function finishRec(fromStop) {
    if (mode === "armed") { mode = "live"; take = take && take.steps.length ? take : null; }
    else if (mode === "rec") {
      // keep whole bars only
      const whole = Math.floor(take.steps.length / take.len) * take.len;
      take.steps = take.steps.slice(0, whole || take.steps.length);
      mode = "live";
    }
    if (!fromStop) syncButtons();
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
    if (mode === "rec" || mode === "armed" || mode === "take") stop();
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
    if (t.closest && t.closest("a, button, input, select, textarea, [contenteditable], [role=button], .menu, .a11y")) return;
    if (t !== document.body && !root.contains(t)) return;
    const r = root.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return;   // game not on screen: let the page scroll
    e.preventDefault(); btn("play").click();
  });
  addEventListener("pagehide", () => { if (playing) stop(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && playing) stop(); });
  root.addEventListener("pointerdown", () => audio(), { once: true });

  /* ---------- share link: #r=salsa&t=160&c=32&f=10110110&a=nn ---------- */
  // #r=salsa&t=160&c=32&f=16 digits (4 hands)&a=4 styles (n/s/t)&i=4 instruments (t/x/d/v)
  const ART_CODE = { normal: "n", sustain: "s", staccato: "t" }, CODE_ART = { n: "normal", s: "sustain", t: "staccato" };
  function saveHash() {
    const f = pattern.map(p => p.fingers.join("")).join("");
    const a = pattern.map(p => ART_CODE[p.art]).join("");
    const i = pattern.map(p => INST_CODE[p.inst]).join("");
    const h = `#r=${curKey}&t=${bpm}&c=${claveMode}&f=${f}&a=${a}&i=${i}`;
    if (location.hash !== h) history.replaceState(null, "", h);
  }
  function loadHash() {
    const q = new URLSearchParams(location.hash.slice(1));
    if (q.get("r") && RHYTHMS[q.get("r")]) { curKey = q.get("r"); cur = RHYTHMS[curKey]; bpm = cur.bpm; }
    const t = +q.get("t"); if (t >= 60 && t <= 240) bpm = t;
    if (q.get("c") === "23") claveMode = "23";
    const f = q.get("f");
    if (f && /^([01]{8}|[01]{16})$/.test(f)) pattern.forEach((p, h) => { if (h * 4 < f.length) p.fingers = f.slice(h * 4, h * 4 + 4).split("").map(Number); });
    const a = q.get("a"); if (a && /^[nst]{2,4}$/.test(a)) pattern.forEach((p, h) => { if (a[h]) p.art = CODE_ART[a[h]]; });
    const i = q.get("i"); if (i && /^[txdv]{4}$/.test(i)) pattern.forEach((p, h) => { p.inst = CODE_INST[i[h]]; });
  }

  /* ---------- go ---------- */
  loadHash();
  rhythmSel.value = curKey; claveSel.value = claveMode;
  claveWrap.hidden = !cur.clave;
  rebuild(); setTempo(bpm); renderLanes(); renderHands(); syncButtons(); haveStatus();

  // test hook (only with ?mans-test): render a few bars offline to check levels
  if (/[?&]mans-test\b/.test(location.search)) {
    window.__mansRender = async (key, seconds, opts = {}) => {
      const off = new OfflineAudioContext(1, Math.ceil(44100 * seconds), 44100);
      const keep = { ctx, master, noiseBuf, drumsOn, handsOn, curKey, bpm, pattern: JSON.parse(JSON.stringify(pattern)) };
      init(off); applyRhythm(key); drumsOn = opts.drums !== false; handsOn = opts.hands !== false;
      if (opts.hands4) opts.hands4.forEach((o, h) => Object.assign(pattern[h], o));
      let s = 0, tt = 0.05;
      while (tt < seconds - 0.5) { scheduleStep(s, tt); s = (s + 1) % cur.len; tt += stepDur(); }
      const buf = await off.startRendering(), d = buf.getChannelData(0);
      let pk = 0, sq = 0; for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; sq += d[i] * d[i]; }
      ({ ctx, master, noiseBuf, drumsOn, handsOn } = keep); pattern = keep.pattern; applyRhythm(keep.curKey); setTempo(keep.bpm);
      return { peak: +pk.toFixed(3), rms: +Math.sqrt(sq / d.length).toFixed(4) };
    };
  }
})();
