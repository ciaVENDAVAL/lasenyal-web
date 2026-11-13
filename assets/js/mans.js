// Mans / Manos / Hands — a hand-rhythm game for La Senyal.
// Based on "Mans — VENDAVAL" v3. Two hands, thumbs outward; each finger = one eighth note.
// Finger up = the trumpet plays, folded = rest. Everything is scoped to #mans; no storage,
// no network. The current groove lives in the URL hash so it can be shared.
(() => {
  "use strict";
  const root = document.getElementById("mans");
  if (!root) return;
  const T = JSON.parse(root.querySelector(".mans__t").textContent);
  const $ = sel => root.querySelector(`[data-ctl="${sel}"]`);
  const btn = act => root.querySelector(`[data-act="${act}"]`);
  const fmt = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k]);

  const PITCH = 466.16; // one tone only: Bb4, trumpet
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
  // pattern[0] = left hand, pattern[1] = right hand; fingers in on-screen order (left to right).
  let pattern = [{ fingers: [1, 0, 1, 1], art: "normal" }, { fingers: [0, 1, 1, 0], art: "normal" }];
  let curKey = "salsa", cur = RHYTHMS[curKey], curLanes = [], claveMode = "32", bpm = cur.bpm;
  let drumsOn = true, trumpetOn = true;
  let playing = false, step = 0, nextTime = 0, timer = null, raf = null, uiQ = [], prevStep = -1;

  // recording: one entry per trumpet step: {on, art}. A "take" replays it.
  let mode = "live";          // live | armed | rec | take
  let take = null;            // {key, clave, bpm, len, steps:[{on,art}]}
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
    master = ac.createGain(); master.gain.value = 0.82;
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

  function trumpet(t, dur) {
    const ac = ctx;
    const o1 = ac.createOscillator(), o2 = ac.createOscillator();
    o1.type = o2.type = "sawtooth";
    o1.frequency.value = PITCH; o2.frequency.value = PITCH; o2.detune.value = 6;
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

  // which notes sound at trumpet index idx: live hands, or the recorded take
  function liveNote(idx) {
    const Tn = tl(), h = idx >> 2, f = idx & 3;
    if (!pattern[h].fingers[f]) return null;
    let gap = 6;
    for (let i = 1; i <= 6; i++) { const m = (idx + i) % Tn; if (pattern[m >> 2].fingers[m & 3]) { gap = i; break; } }
    return { art: pattern[h].art, gap };
  }
  function takeNote(pos) {
    const s = take.steps[pos];
    if (!s.on) return null;
    let gap = 6;
    for (let i = 1; i <= 6; i++) { if (take.steps[(pos + i) % take.steps.length].on) { gap = i; break; } }
    return { art: s.art, gap };
  }

  function scheduleStep(n, t) {
    const sd = stepDur(), Tn = tl(), idx = n % Tn;
    if (drumsOn) curLanes.forEach(l => { const ch = l.p[n % l.p.length]; if (ch && ch !== ".") hitVoice(l.v, ch, t); });

    // start recording on a bar line
    if (mode === "armed" && idx === 0) { mode = "rec"; recPos = 0; take = { key: curKey, clave: claveMode, bpm, len: Tn, steps: [] }; }
    let note = null, ui = { step: n, time: t };
    if (mode === "take") {
      note = takeNote(takePos);
      ui.take = takePos; takePos = (takePos + 1) % take.steps.length;
    } else {
      note = liveNote(idx);
      if (mode === "rec") {
        const h = idx >> 2;
        take.steps.push({ on: !!pattern[h].fingers[idx & 3], art: pattern[h].art });
        ui.rec = take.steps.length;
        if (take.steps.length >= MAX_BARS * Tn) ui.recDone = true;
      }
    }
    if (trumpetOn && note) trumpet(t, noteLen(note.art, note.gap, sd));
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
    const lens = h === 0 ? LEN_LEFT : LEN_RIGHT;
    let o = `<svg viewBox="0 0 110 118" role="group" aria-label="${h === 0 ? T.left_short : T.right_short}">`;
    [10, 15, 20, 25, 30].forEach(y => { o += `<line x1="6" y1="${y}" x2="104" y2="${y}" class="staffl"/>`; });
    o += `<rect class="palm" x="14" y="70" width="82" height="44" rx="14"/>`;
    o += h === 0
      ? `<rect class="thumb" x="1" y="82" width="13" height="26" rx="6.5" transform="rotate(-28 8 95)"/>`
      : `<rect class="thumb" x="96" y="82" width="13" height="26" rx="6.5" transform="rotate(28 102 95)"/>`;
    o += `<path class="knuckles" d="M22 80 h66" />`;
    for (let i = 0; i < 4; i++) {
      const on = !!fingers[i], c = CX[i], L = lens[i];
      const dis = h === 1 && i === 3 && tl() === 7;
      const num = h * 4 + i + 1;
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
  pattern.forEach((p, h) => {
    const el = document.createElement("div");
    el.className = "slot"; el.dataset.s = h;
    el.innerHTML = `<div class="cap">${h === 0 ? T.left : T.right}</div><div class="hand"></div>` +
      `<div class="art" role="group">` + ARTS.map(a => `<button type="button" data-art="${a[0]}" aria-pressed="false">${a[1]}</button>`).join("") + `</div>`;
    slotsEl.appendChild(el);
  });
  function renderSlot(h, shown) {
    const p = shown || pattern[h];
    const el = slotsEl.children[h];
    const focused = document.activeElement && el.contains(document.activeElement) && document.activeElement.dataset.f;
    el.querySelector(".hand").innerHTML = handSVG(h, p.fingers);
    el.querySelectorAll("[data-art]").forEach(b => { const s = b.dataset.art === p.art; b.classList.toggle("sel", s); b.setAttribute("aria-pressed", String(s)); });
    if (focused !== undefined && focused !== false && focused !== null) { const g = el.querySelector(`g[data-f="${focused}"]`); if (g) g.focus(); }
    if (prevStep >= 0) setPlayhead(prevStep);
  }
  const renderHands = () => pattern.forEach((p, h) => renderSlot(h));

  function toggleFinger(h, f) {
    if (mode === "take") return;
    pattern[h].fingers[f] = pattern[h].fingers[f] ? 0 : 1;
    renderSlot(h); saveHash();
    if (pattern[h].fingers[f] && trumpetOn && !playing) { const ac = audio(); trumpet(ac.currentTime + 0.01, 0.3); }
  }
  slotsEl.addEventListener("click", e => {
    const slot = e.target.closest(".slot"); if (!slot) return;
    const h = +slot.dataset.s;
    const ab = e.target.closest("[data-art]");
    if (ab) { if (mode === "take") return; pattern[h].art = ab.dataset.art; renderSlot(h); saveHash(); return; }
    const fg = e.target.closest("[data-f]");
    if (fg && !fg.classList.contains("dis")) toggleFinger(h, +fg.dataset.f);
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
    const idx = n % tl(), slot = slotsEl.children[idx >> 2];
    slot.classList.add("cur");
    const g = slot.querySelector(`g[data-f="${idx & 3}"]`);
    if (g) g.classList.add("playing");
  }

  /* take playback: the hands show the recorded bar */
  function showTakeStep(pos) {
    if (pos % take.len !== 0) return;
    const bar = take.steps.slice(pos, pos + take.len);
    [0, 1].forEach(h => {
      const fingers = [0, 1, 2, 3].map(f => { const s = bar[h * 4 + f]; return s && s.on ? 1 : 0; });
      const s0 = bar[h * 4] || bar[0];
      renderSlot(h, { fingers, art: s0 ? s0.art : "normal" });
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
  btn("trumpet").addEventListener("click", () => { trumpetOn = !trumpetOn; setBtn("trumpet", trumpetOn); });
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
  const ART_CODE = { normal: "n", sustain: "s", staccato: "t" }, CODE_ART = { n: "normal", s: "sustain", t: "staccato" };
  function saveHash() {
    const f = pattern.map(p => p.fingers.join("")).join("");
    const a = pattern.map(p => ART_CODE[p.art]).join("");
    const h = `#r=${curKey}&t=${bpm}&c=${claveMode}&f=${f}&a=${a}`;
    if (location.hash !== h) history.replaceState(null, "", h);
  }
  function loadHash() {
    const q = new URLSearchParams(location.hash.slice(1));
    if (q.get("r") && RHYTHMS[q.get("r")]) { curKey = q.get("r"); cur = RHYTHMS[curKey]; bpm = cur.bpm; }
    const t = +q.get("t"); if (t >= 60 && t <= 240) bpm = t;
    if (q.get("c") === "23") claveMode = "23";
    const f = q.get("f"); if (f && /^[01]{8}$/.test(f)) pattern.forEach((p, h) => { p.fingers = f.slice(h * 4, h * 4 + 4).split("").map(Number); });
    const a = q.get("a"); if (a && /^[nst]{2}$/.test(a)) pattern.forEach((p, h) => { p.art = CODE_ART[a[h]]; });
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
      const keep = { ctx, master, noiseBuf, drumsOn, trumpetOn, curKey, bpm };
      init(off); applyRhythm(key); drumsOn = opts.drums !== false; trumpetOn = opts.trumpet !== false;
      if (opts.fingers) pattern.forEach((p, h) => { p.fingers = opts.fingers.slice(h * 4, h * 4 + 4); p.art = opts.art || "normal"; });
      let s = 0, tt = 0.05;
      while (tt < seconds - 0.5) { scheduleStep(s, tt); s = (s + 1) % cur.len; tt += stepDur(); }
      const buf = await off.startRendering(), d = buf.getChannelData(0);
      let pk = 0, sq = 0; for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; sq += d[i] * d[i]; }
      ({ ctx, master, noiseBuf, drumsOn, trumpetOn } = keep); applyRhythm(keep.curKey); setTempo(keep.bpm);
      return { peak: +pk.toFixed(3), rms: +Math.sqrt(sq / d.length).toFixed(4) };
    };
  }
})();
