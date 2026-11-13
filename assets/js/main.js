// La Senyal — small helpers, no dependencies.
(() => {
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

  // 2. Lightbox for photos (home strip + intro photo).
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
