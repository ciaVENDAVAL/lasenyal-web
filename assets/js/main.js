// La Senyal — small helpers, no dependencies.
(() => {
  // 0. Menu (top right): opens a panel from the button.
  const menuBtn = document.querySelector(".menu-btn"), menu = document.getElementById("menu");
  if (menuBtn && menu) {
    const lbl = menuBtn.querySelector(".sr");
    const isOpen = () => menuBtn.getAttribute("aria-expanded") === "true";
    const setMenu = open => {
      menuBtn.setAttribute("aria-expanded", String(open));
      lbl.textContent = open ? lbl.dataset.close : lbl.dataset.open;
      if (open) { menu.hidden = false; requestAnimationFrame(() => { menu.classList.add("is-open"); requestAnimationFrame(() => menu.querySelector("a").focus({ preventScroll: true })); }); }
      else { menu.classList.remove("is-open"); setTimeout(() => { if (!menu.classList.contains("is-open")) menu.hidden = true; }, 600); }
    };
    menuBtn.addEventListener("click", e => { e.stopPropagation(); setMenu(!isOpen()); });
    menu.addEventListener("click", e => { if (e.target.closest('a[href^="#"]')) setMenu(false); });
    // top of page: all links; scrolled: the 3-line box
    let scrolled = null;
    const onScroll = () => {
      const now = scrollY > 60;
      if (now === scrolled) return;
      scrolled = now;
      document.documentElement.classList.toggle("is-scrolled", now);
      menuBtn.tabIndex = now ? 0 : -1;
      if (!now && isOpen()) setMenu(false);
    };
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    document.addEventListener("click", e => { if (isOpen() && !e.target.closest("#menu")) setMenu(false); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && isOpen()) { setMenu(false); menuBtn.focus(); } });
  }

  // 1. Concerts: the page is built on GitHub, so it only knows the date of the last build.
  //    Here we move any concert whose day has passed from "upcoming" to "past".
  const pad = n => String(n).padStart(2, "0");
  const d = new Date();
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const up = document.querySelector('[data-list="upcoming"]');
  const past = document.querySelector('[data-list="past"]');
  if (up) {
    [...up.querySelectorAll(".gig")].reverse().forEach(g => {
      if (g.dataset.end < today) {
        if (past && !g.classList.contains("gig--res")) past.prepend(g); else g.remove();
      }
    });
    const max = +up.dataset.max || 0;
    if (max) [...up.children].slice(max).forEach(g => g.remove());
    const none = up.parentElement.querySelector(".gigs__none");
    if (none) none.hidden = up.children.length > 0;
  }

  // 2. Video after the hero: plays muted in the page (tap to unmute).
  //    If YouTube refuses to play it here, the photo with a link to YouTube stays instead.
  const stopped = () => document.documentElement.classList.contains("a11y-motion");
  const vid = document.querySelector(".video[data-yt]");
  if (vid && !stopped()) {
    const id = vid.dataset.yt;
    const start = () => {
      const holder = document.createElement("div");
      vid.appendChild(holder);
      window.onYouTubeIframeAPIReady = () => {
        const player = new YT.Player(holder, {
          videoId: id,
          host: "https://www.youtube-nocookie.com",
          playerVars: { autoplay: stopped() ? 0 : 1, mute: 1, loop: 1, playlist: id, playsinline: 1, rel: 0, modestbranding: 1 },
          events: {
            onReady: e => { e.target.mute(); if (!stopped()) e.target.playVideo(); },
            onStateChange: e => { if (e.data === 1) vid.classList.add("is-playing"); },
            onError: () => { vid.classList.remove("is-playing"); player.destroy(); },
          },
        });
      };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    };
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: "300px" });
      io.observe(vid);
    } else start();
  }

  // 3. Accessibility panel (choices are remembered in this browser).
  const KEY = "ls-a11y", root = document.documentElement;
  const prefs = (() => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) {} };
  const TOGGLES = ["light", "motion", "contrast", "links", "spacing", "font"];
  const aBtn = document.querySelector(".a11y-btn"), panel = document.getElementById("a11y-panel");
  const apply = () => {
    TOGGLES.forEach(k => root.classList.toggle("a11y-" + k, !!prefs[k]));
    root.style.setProperty("--fs", prefs.size || 1);
    if (!panel) return;
    panel.querySelectorAll("[data-a]").forEach(b => { if (TOGGLES.includes(b.dataset.a)) b.setAttribute("aria-pressed", String(!!prefs[b.dataset.a])); });
    panel.querySelector(".a11y-size__val").textContent = Math.round((prefs.size || 1) * 100) + "%";
    if (prefs.motion && vid) { const f = vid.querySelector("iframe"); if (f) f.remove(); vid.classList.remove("is-playing"); }
  };
  if (aBtn && panel) {
    const setOpen = open => { aBtn.setAttribute("aria-expanded", String(open)); panel.hidden = !open; };
    aBtn.addEventListener("click", () => { const open = panel.hidden; setOpen(open); if (open) panel.querySelector("button").focus(); });
    panel.addEventListener("click", e => {
      const b = e.target.closest("[data-a]"); if (!b) return;
      const k = b.dataset.a;
      if (TOGGLES.includes(k)) prefs[k] = !prefs[k];
      else if (k === "bigger") prefs.size = Math.min(1.6, Math.round(((prefs.size || 1) + .1) * 10) / 10);
      else if (k === "smaller") prefs.size = Math.max(.8, Math.round(((prefs.size || 1) - .1) * 10) / 10);
      else if (k === "reset") Object.keys(prefs).forEach(x => delete prefs[x]);
      save(); apply();
    });
    document.addEventListener("click", e => { if (!panel.hidden && !e.target.closest(".a11y")) setOpen(false); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !panel.hidden) { setOpen(false); aBtn.focus(); } });
  }
  apply();

  // 4. Lightbox for photos (home strip + intro photo).
  const lb = document.getElementById("lb");
  if (!lb) return;
  const big = lb.querySelector("img");
  const items = [...document.querySelectorAll("[data-gal], [data-lg]")];
  let i = 0, opener = null;
  const src = el => el.getAttribute("href") || el.dataset.lg;
  const show = k => { i = (k + items.length) % items.length; big.src = src(items[i]); };
  const open = (k, el) => { opener = el; show(k); lb.hidden = false; document.body.style.overflow = "hidden"; lb.querySelector(".lb__x").focus(); };
  const close = () => { lb.hidden = true; big.removeAttribute("src"); document.body.style.overflow = ""; opener && opener.focus(); };
  items.forEach((el, k) => {
    if (el.tagName === "IMG") { el.tabIndex = 0; el.setAttribute("role", "button"); }
    el.addEventListener("click", e => { e.preventDefault(); open(k, el); });
    el.addEventListener("keydown", e => { if (el.tagName === "IMG" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(k, el); } });
  });
  lb.querySelector(".lb__x").onclick = close;
  lb.querySelector(".lb__prev").onclick = () => show(i - 1);
  lb.querySelector(".lb__next").onclick = () => show(i + 1);
  lb.addEventListener("click", e => { if (e.target === lb) close(); });
  document.addEventListener("keydown", e => {
    if (lb.hidden) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") show(i - 1);
    if (e.key === "ArrowRight") show(i + 1);
  });
  let x0 = null;
  lb.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener("touchend", e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) show(i + (dx < 0 ? 1 : -1));
    x0 = null;
  });
})();
