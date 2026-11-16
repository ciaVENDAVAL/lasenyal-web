# UPDATING — change a fact in every place and language

1. **Fact sheet first.** Update `master/LA SENYAL master fact sheet.md` in the claude.ai Project *La Senyal*
   (read it right before writing — other sessions may have changed it). "Just collect" = only the sheet, nothing else.
2. **Then every place that uses it**, in CA, ES and EN. (Website texts changed in one language only are translated
   into the others automatically (Softcatalà open models) — check the result; to write all three by hand, change them in one commit.) Use the table below.
3. **PDFs** that contain the fact: rebuild (`python3 dossiers/presskit/build.py`), then update `INDEX.md` in lasenyal-docs.
4. `python3 tools/check.py` — no ERROR. Commit, push, and list what changed (to tyle and in the session log).

| Fact | Website (this repo) | Press kit PDF | Elsewhere |
|---|---|---|---|
| Band description, tagline, how it works | `_data/i18n/*.yml` (`intro`, `intro2`, `tagline`, `how`, `meta_description`) | `pk_*` keys + same keys | email templates (Project) |
| Members, roles, Instagram, photos | `_data/members.yml`; role names `roles:` in `_data/i18n/*.yml` | yes (line-up) | `members_intro` ("Deu músics…") if the number changes |
| Concerts, Superlunes / Superdilluns | `_data/concerts.yml` | yes (archive) | fact sheet track record |
| Booking email, phones, Instagram, video | `_data/site.yml` | yes (contact strip) | email templates, lasenyal-docs contacts |
| Formats (stage / street…) | `pk_formats` in `_data/i18n/*.yml` | yes | fact sheet → Shows |
| Main photos, photo strip | `_data/site.yml` → `images`, `_data/gallery.yml` | cover / page 2 | credits in `source-images/README.md` |
| Which PDF the short link gives | `_data/downloads.yml` | — | `INDEX.md` in lasenyal-docs |
| Menu, colours, font | `_data/menu.yml`, `_data/theme.yml` | — | — |

Most of these can also be changed in the admin (https://ciavendaval.github.io/lasenyal-admin/) — it edits the same files.
