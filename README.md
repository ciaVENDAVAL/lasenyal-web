# lasenyal-web

Website for **La Senyal**, built for **GitHub Pages** (plain Jekyll, no plugins, nothing to install).

**Staging address:** https://ciavendaval.github.io/lasenyal-web/
PDFs (press kit) go in the sister repo **lasenyal-docs**.

## What's in it

- **4 pages:** Home, Members, Concerts, Hands (game) — in **CA** (`/ca/`, `/ca/equip/`, `/ca/concerts/`, `/ca/mans/`), **ES** (`/`, `/equipo/`, `/conciertos/`, `/manos/`) and **EN** (`/en/`, `/en/members/`, `/en/concerts/`, `/en/hands/`). ES stays at the root like the old site; the old `/inicio/` address redirects.
- **Contact** sits small in the footer of every page, with the press kit in the visitor's language.
- **Photos are local** (`assets/img/sm` = thumbnails, `assets/img/lg` = full size, `assets/img/members` = portraits). Click a photo on the home page to open it full size (arrows, keyboard ← →, swipe, Esc).
- **Accessibility button** (bottom left, like the other ciaVENDAVAL sites): light theme, stop animations and video, high contrast, underline links, line spacing, easier font, text size. Choices are remembered per browser. The footer keeps a left margin so the button never covers its text.
- **Press kit:** a hidden page at `/presskit/<lang>/`, printed to PDF by `scripts/presskit.py`.

## The hands game (Mans / Manos / Hands)

Two hands, thumbs outward; each finger is an eighth note (finger up = it plays). Each hand picks an instrument: trumpet (B♭), sax (F), voice (D) — together a B♭ major chord — or djembe slap (percussion, so the playing-style buttons are off). Six rhythms, tempo, clave 3-2/2-3, playing style per hand.
The page has four collapsible sections: **Hands** (each pair also folds away), **Rhythm**, **Volume** and **Break**.
- **Volume:** one open-hand fader per channel (drums, each hand, soloist), drawn diagonal with the palm up. Drag it up for louder, down for softer (arrow keys work too).
- **Break:** pick the soloist (trumpet, sax, djembe, voice), then tap the moving open hand (palm up, fingers to the upper left). At the next bar everyone stops and the soloist improvises one bar (random each time, B♭ major pentatonic; djembe mixes bass, tone and slap). Then the band comes back in.

A small floating bar (play, record, stop) appears at the bottom right when you scroll past the main controls.
**Record** starts at the next bar and keeps what the hands play (up to 32 bars); **Play recording** replays it with the hands moving.
The current hands, rhythm, tempo, volumes and soloist are kept in the page address, so **Copy link** shares a groove.

- Code: `assets/js/mans.js` (rhythms are in the `RHYTHMS` object at the top). Page: `_layouts/hands.html`. Texts: `mans:` in the language files.
- Sound is synthesized in the browser (no files). Levels were checked by rendering offline: open the page with `?mans-test` and run `__mansRender("salsa", 4)` in the console.
- Based on "Mans — VENDAVAL" v3.

## Add a concert

Open `_data/concerts.yml` (on GitHub: the file → pencil icon) and add at the top:

```yaml
- date: 2027-03-14
  venue: Sala Apolo
  place: Poble-sec, Barcelona
  time: "21:00"                       # optional
  map: https://maps.app.goo.gl/…      # optional
  link: https://…                     # optional, tickets / info
```

Commit. In a minute it shows under **Upcoming** on the home page (next 3) and on the Concerts page. The day after the concert it moves to **Past** by itself — no need to edit anything.

**Superlunes** (weekly residencies) use `residency: true`, an `end:` date and an optional `photo:` from `assets/img/sm/`. If only the year is known, add `label: "2024"`.

## Edit content

| What | Where |
|---|---|
| All texts, per language (also the press kit texts `pk_*`) | `_data/i18n/ca.yml`, `es.yml`, `en.yml` (same keys in every file) |
| Concerts and Superlunes | `_data/concerts.yml` |
| Members: name, instrument, photo, Instagram | `_data/members.yml` (instrument names are under `roles:` in the language files) |
| Home photo strip | `_data/gallery.yml` |
| Email, phones, Instagram, video, page addresses | `_config.yml` |
| Look & feel | `assets/css/main.css` (colours and fonts at the top) |
| Press kit layout | `_layouts/presskit.html` |
| Accessibility panel | `_includes/a11y.html`, texts under `a11y:` in the language files |

**Add photos:** save a thumbnail (about 820 px on the long side) in `assets/img/sm/` and a large version (about 1800 px) with the **same name** in `assets/img/lg/`.

**Fonts:** headings use *Archivo Expanded Black* (free, Google Fonts). The old site used a **trial** copy of Druk Text Wide, which is not licensed for a live site. If you buy a Druk web licence, put the files in `assets/fonts/` and change `--display` in `main.css`.

## Update the press kit PDFs

After changing texts, members or concerts:

```
gem install jekyll -v '~> 3.10'
pip install playwright && playwright install chromium
python scripts/presskit.py ../lasenyal-docs/pdf
```

Then commit and push the PDFs in **lasenyal-docs**.

## Switch the domain to lasenyal.com (when ready to leave WordPress)

1. In `_config.yml`: `url: https://lasenyal.com` and `baseurl: ""`.
2. Add a file named `CNAME` containing `lasenyal.com`.
3. At your DNS provider, point the apex to GitHub with A records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`, and set `www` as a CNAME to `ciavendaval.github.io`.
4. In the repo, open **Settings → Pages**, enter the custom domain, and tick **Enforce HTTPS**.

## Local preview

`bundle install && bundle exec jekyll serve`, then open http://localhost:4000/lasenyal-web/
