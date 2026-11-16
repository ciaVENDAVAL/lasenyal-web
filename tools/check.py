"""Cross-checks the website before every push and writes CHECK-REPORT.md.

  python3 tools/check.py          (exit code 1 if there is an ERROR)

Checks: every language has every text · downloads exist for every language · extra pages
exist in every language · every photo has its small copy and every referenced photo exists ·
press kit PDFs still contain the current contact data · no private data in this public repo ·
spellings and banned words from tools/facts.yml.  Needs: pip install pyyaml pypdf"""
import re, sys, subprocess
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parent.parent
LANGS = ["ca", "es", "en"]
facts = yaml.safe_load((ROOT / "tools/facts.yml").read_text())
out = {"ERROR": [], "WARN": [], "OK": []}
def err(m): out["ERROR"].append(m)
def warn(m): out["WARN"].append(m)
def ok(m): out["OK"].append(m)
data = lambda p: yaml.safe_load((ROOT / p).read_text())

# 1. texts: same keys, nothing empty
def flat(x, p=""):
    if isinstance(x, dict):
        for k, v in x.items(): yield from flat(v, f"{p}{k}.")
    elif isinstance(x, list):
        for i, v in enumerate(x): yield from flat(v, f"{p}{i}.")
    else: yield p[:-1], x
txt = {l: dict(flat(data(f"_data/i18n/{l}.yml"))) for l in LANGS}
keys = set().union(*txt.values())
miss = 0
for k in sorted(keys):
    if k.startswith("mans.rhythms"): continue
    for l in LANGS:
        if k not in txt[l]: err(f"text `{k}` missing in **{l.upper()}**"); miss += 1
        elif txt[l][k] in ("", None): warn(f"text `{k}` empty in **{l.upper()}**"); miss += 1
if not miss: ok(f"texts: {len(keys)} keys in CA, ES and EN")

# 2. downloads
dl = data("_data/downloads.yml") or {}
for kind, per in dl.items():
    for l in LANGS:
        f = (per or {}).get(l)
        if not f: err(f"download `{kind}` has no **{l.upper()}** file")
        elif not (ROOT / f.lstrip("/")).exists(): err(f"download `{kind}` {l.upper()}: `{f}` does not exist")
    for l in LANGS:
        if not (ROOT / f"dossier/{l}/index.html").exists() and kind == "presskit": err(f"short link /dossier/{l}/ missing")
ok(f"downloads: {', '.join(dl)} checked")
used = {str((ROOT / f.lstrip('/')).resolve()) for per in dl.values() for f in (per or {}).values() if f}
for f in sorted((ROOT / "pdf").glob("*.pdf")):
    if str(f.resolve()) not in used: warn(f"`pdf/{f.name}` is not used by any short link (old version? keep or delete)")
    if f.stat().st_size > 3e6: warn(f"`pdf/{f.name}` is {f.stat().st_size/1e6:.1f} MB (promoter dossier ≤ 3 MB)")
    if not re.fullmatch(r"LaSenyal_(CA|ES|EN)_[a-z-]+_\d{4}-\d{2}\.pdf", f.name): warn(f"`pdf/{f.name}`: name should be LaSenyal_<LANG>_<kind>_<yyyy-mm>.pdf")

# 3. extra pages in every language
pages = {}
for l in LANGS:
    for f in (ROOT / "_extra" / l).glob("*.md"): pages.setdefault(f.stem, set()).add(l)
for name, ls in sorted(pages.items()):
    if set(LANGS) - ls: warn(f"page `{name}` only in {', '.join(sorted(x.upper() for x in ls))}")
ok(f"pages: {len(pages)} extra page(s)")

# 4. photos
lg = ROOT / "assets/img/lg"; sm = ROOT / "assets/img/sm"
for f in lg.iterdir():
    if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp") and not (sm / f.name).exists():
        err(f"photo `{f.name}` has no small copy in assets/img/sm/ (run tools/photos.py)")
refs = []
for p in ["_data/site.yml", "_data/gallery.yml", "_data/members.yml", "_data/concerts.yml"]:
    refs += re.findall(r"(/assets/img/[\w./-]+\.(?:jpe?g|png|webp))", (ROOT / p).read_text())
for r in set(refs):
    if not (ROOT / r.lstrip("/")).exists(): err(f"photo `{r}` is used but does not exist")
ok(f"photos: {len(set(refs))} referenced photos checked")

# 5. PDFs still match the contact data
site = data("_data/site.yml")["contact"]
try:
    import pypdf
    for kind, per in dl.items():
        for l, f in (per or {}).items():
            p = ROOT / f.lstrip("/")
            if not p.exists(): continue
            t = " ".join(pg.extract_text() or "" for pg in pypdf.PdfReader(p).pages)
            t = re.sub(r"\s+", " ", t)
            for v in [site["email"], *site.get("phones", [])]:
                if v.replace(" ", "") not in t.replace(" ", ""): warn(f"`{f}` does not contain `{v}` (rebuild the PDF?)")
    ok("PDFs: contact data compared")
except ImportError:
    warn("pypdf not installed: PDF contents not checked")

# 6. private data, spellings, banned words — every tracked text file
files = subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], cwd=ROOT, capture_output=True, text=True).stdout.split()
skip = ("tools/facts.yml", "CHECK-REPORT.md", "Gemfile.lock")
texts = [f for f in files if f.endswith((".yml", ".md", ".html", ".js", ".txt", ".json", ".css")) and f not in skip]
for f in texts:
    s = (ROOT / f).read_text(errors="ignore")
    rules_doc = f in ("CLAUDE.md", "README.md", "UPDATING.md") or f.startswith("assets/fonts/")  # rules and font licences name these words on purpose
    for r in ([] if rules_doc else facts.get("private", [])):
        for m in re.finditer(r["pattern"], s):
            line = s[:m.start()].count("\n") + 1
            err(f"possible private data ({r['why']}) in `{f}:{line}`: “{m.group(0)}”")
    for r in facts.get("spelling", []):
        if r.get("only_in") and not any(f.startswith(x) for x in r["only_in"]): continue
        for m in re.finditer(r["pattern"], s):
            line = s[:m.start()].count("\n") + 1
            warn(f"spelling in `{f}:{line}`: “{m.group(0)}” → {r['correct']}")
    for w in facts.get("banned", []) or []:
        for m in re.finditer(rf"(?i)\b{re.escape(w)}\b", s):
            warn(f"banned word “{w}” in `{f}:{s[:m.start()].count(chr(10))+1}`")
ok(f"scan: {len(texts)} files for private data and house style")

rep = ["# CHECK-REPORT", "", "Generated by `python3 tools/check.py`. Fix every ERROR before pushing.", ""]
for k in ("ERROR", "WARN", "OK"):
    rep.append(f"## {k} ({len(out[k])})"); rep += [f"- {m}" for m in out[k]] or ["- none"]; rep.append("")
(ROOT / "CHECK-REPORT.md").write_text("\n".join(rep))
print("\n".join(rep))
sys.exit(1 if out["ERROR"] else 0)
