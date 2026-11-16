# CLAUDE.md — lasenyal-web (PUBLIC repo)

Website and public material of **La Senyal** (Barcelona). Same structure as ciaVENDAVAL's other companies
(handoff "how to organise a company"), but this site is **Jekyll** (GitHub builds it from `main`, root), not build.py.

## Where things are true
- **Facts** (names, roles, dates, contact, formats…) come from the master fact sheet in the claude.ai Project
  *La Senyal* (`master/LA SENYAL master fact sheet.md`). Newest info wins: update the sheet, then every file and
  language that uses the fact (see `UPDATING.md`), then list what changed.
- Website texts: `_data/i18n/{ca,es,en}.yml` (same keys in all three) · data: `_data/*.yml` · pages: `_layouts/`.
- The admin (repo `lasenyal-admin`, Sveltia CMS) and the on-page editor (`#edit`, `assets/js/edit.js`) edit these
  same files and commit to `main`. Pull before working. The on-page editor finds texts by exact wording: a text
  shown through a filter or glued to other text is not editable there (use the admin).

## Never in this repo
Fees, budgets, tax IDs (NIF/CIF/DNI), bank data, team members' private phones/addresses/IDs, application answers —
not in text, PDFs, file names or commit messages. Those go to the private repo **lasenyal-docs**.
The booking email and phones in `_data/site.yml` are the band's public contact, on purpose.

## PDFs
- Public PDFs live in `pdf/` as `LaSenyal_<LANG>_<kind>_<yyyy-mm>.pdf`. Never edit a PDF by hand: change the source,
  rebuild, then update `INDEX.md` in lasenyal-docs.
- Press kit: `python3 dossiers/presskit/build.py [langs]` (source: `_layouts/presskit.html` + `pk_*` texts + members/concerts).
- Emails link to the short links `lasenyal.com/dossier/<lang>/` (from `_data/downloads.yml`), never attach PDFs.
- Every dossier: Team + Credits (photographers) in every language, technical contact, recommended age, duration;
  ≤ 15–20 pages, ≤ 3 MB. Don't rebuild a PDF whose text hasn't changed.

## Languages
CA · ES · EN, always all three and consistent. A text changed in only ONE language is auto-translated into the
other two after the push (Softcatalà open models, run in the workflow) (`tools/translate.py`); when you translate by hand, change all three in the same
commit (or add `[no-translate]` to the message). Tell tyle when something exists in one language and not the others.
ES is at the root (`/`), CA at `/ca/`, EN at `/en/`.

## Photos
Originals in `source-images/` (never cropped); web sizes in `assets/img/` are generated (`tools/photos.py`, run by
the photo workflow). Credit every photographer (`source-images/README.md` + fact sheet). Private photos → lasenyal-docs.

## House style
⚠ Not decided yet — rules go in the fact sheet and as patterns in `tools/facts.yml`. Known: always “La Senyal”
(capital L and S); sign language by Santiago Vázquez / “La Bomba de Tiempo”; ES “Superlunes”, CA “Superdilluns”, EN “Super Mondays”.

## Every session
1. `git pull` (the admin may have committed).  2. Work.  3. `python3 tools/check.py` — no ERROR.
4. Commit and push, author **tyle fernández <lasenyal@anartist.org>**:
   `git fetch origin main && git rebase origin/main && git push origin HEAD:main`.
5. Add a line to the session log in the fact sheet.
