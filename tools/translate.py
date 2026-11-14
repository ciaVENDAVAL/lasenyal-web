"""Change one language, the others follow.

After a push, finds every text that changed in ONE language only (the other languages still have
their old text) and translates it into the other languages with DeepL, then saves those files.
Texts changed in two or three languages are left alone (someone translated them by hand).

  python3 tools/translate.py <old-commit> [<new-commit>]     (needs DEEPL_API_KEY)
  python3 tools/translate.py <old-commit> --dry-run           (shows what it would translate)

Covers: _data/i18n/{ca,es,en}.yml (every text of the site) and the simple pages _extra/<lang>/<name>.md
(title, intro, photo description, Google description, text; a page new in one language is created in
the others). Names in tools/facts.yml → do_not_translate stay as written; `terms` use each language's form.
Run by .github/workflows/translate.yml. A commit message containing [no-translate] skips it."""
import json, os, re, subprocess, sys, urllib.request, urllib.error
from io import StringIO
from pathlib import Path
from ruamel.yaml import YAML
from ruamel.yaml.scalarstring import DoubleQuotedScalarString as DQ

ROOT = Path(__file__).resolve().parent.parent
LANGS = ["ca", "es", "en"]
DEEPL_TARGET = {"ca": "CA", "es": "ES", "en": "EN-GB"}
DEEPL_SOURCE = {"ca": "CA", "es": "ES", "en": "EN"}
FACTS = YAML(typ="safe").load((ROOT / "tools/facts.yml").read_text())
KEEP = sorted(FACTS.get("do_not_translate") or [], key=len, reverse=True)
TERMS = FACTS.get("terms") or []

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 10_000
yaml.indent(mapping=2, sequence=4, offset=2)

def git_show(rev, path):
    r = subprocess.run(["git", "show", f"{rev}:{path}"], cwd=ROOT, capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None

# ---------- DeepL ----------
def protect(text, src):
    """Wrap names, terms and {placeholders} in tags DeepL leaves alone."""
    t = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    t = re.sub(r"\{(\w+)\}", r'<ph n="\1"/>', t)
    for i, term in enumerate(TERMS):
        if term.get(src): t = re.sub(rf"(?<!\w){re.escape(term[src])}(?!\w)", f'<term n="{i}"/>', t)
    for i, k in enumerate(KEEP):
        t = re.sub(rf"(?<!\w){re.escape(k)}(?!\w)", f'<keep n="{i}"/>', t)
    return t

def unprotect(text, dst):
    t = re.sub(r'<keep n="(\d+)"\s*/>', lambda m: KEEP[int(m.group(1))], text)
    t = re.sub(r'<term n="(\d+)"\s*/>', lambda m: TERMS[int(m.group(1))][dst], t)
    t = re.sub(r'<ph n="(\w+)"\s*/>', r"{\1}", t)
    return t.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")

def deepl(texts, src, dst):
    key = os.environ.get("DEEPL_API_KEY", "").strip()
    if not key: raise SystemExit("DEEPL_API_KEY is not set")
    url = "https://api-free.deepl.com/v2/translate" if key.endswith(":fx") else "https://api.deepl.com/v2/translate"
    body = {"text": [protect(t, src) for t in texts], "source_lang": DEEPL_SOURCE[src], "target_lang": DEEPL_TARGET[dst],
            "tag_handling": "xml", "ignore_tags": ["keep", "term", "ph"], "preserve_formatting": True,
            "model_type": "prefer_quality_optimized"}
    for attempt in range(2):
        req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                     headers={"Authorization": f"DeepL-Auth-Key {key}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return [unprotect(x["text"], dst) for x in json.load(r)["translations"]]
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:300]
            if e.code == 400 and "model_type" in body: body.pop("model_type"); continue   # plan without model choice
            raise SystemExit(f"DeepL {e.code}: {msg}")

# ---------- site texts ----------
def leaves(x, path=()):
    if isinstance(x, dict):
        for k, v in x.items(): yield from leaves(v, path + (k,))
    elif isinstance(x, list):
        for i, v in enumerate(x): yield from leaves(v, path + (i,))
    elif isinstance(x, str): yield path, x

def get(x, path):
    for p in path:
        try: x = x[p]
        except (KeyError, IndexError, TypeError): return None
    return x

def put(x, path, value):
    for p in path[:-1]: x = x[p]
    x[path[-1]] = value

def i18n(old_rev, dry):
    old, new, docs = {}, {}, {}
    for l in LANGS:
        p = f"_data/i18n/{l}.yml"
        o = git_show(old_rev, p)
        old[l] = YAML(typ="safe").load(o) if o else {}
        docs[l] = yaml.load((ROOT / p).read_text())
        new[l] = YAML(typ="safe").load((ROOT / p).read_text())
    jobs = {}   # (src) -> list of path
    for path, _ in leaves(new["ca"]):
        if path and path[0] == "rhythms" or (len(path) > 1 and path[1] == "rhythms"): continue
        changed = [l for l in LANGS if get(new[l], path) != get(old[l], path)]
        if len(changed) == 1 and all(get(new[l], path) is not None for l in LANGS):
            jobs.setdefault(changed[0], []).append(path)
    done = []
    for src, paths in jobs.items():
        texts = [get(new[src], p) for p in paths]
        for dst in LANGS:
            if dst == src: continue
            out = texts if dry else deepl(texts, src, dst)
            for p, t in zip(paths, out):
                if not dry: put(docs[dst], p, DQ(t))
                done.append(f"{'.'.join(map(str, p))}: {src.upper()} → {dst.upper()}")
    if not dry:
        for l in LANGS:
            buf = StringIO(); yaml.dump(docs[l], buf)
            (ROOT / f"_data/i18n/{l}.yml").write_text(buf.getvalue())
    return done

# ---------- simple pages ----------
FM_KEYS = ["title", "intro", "image_alt", "description"]
def split_md(s):
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", s or "", re.S)
    return (YAML(typ="safe").load(m.group(1)) or {}, m.group(2)) if m else ({}, s or "")

def join_md(fm, body):
    buf = StringIO(); y = YAML(); y.width = 10_000
    y.dump({k: (DQ(v) if isinstance(v, str) else v) for k, v in fm.items()}, buf)
    return f"---\n{buf.getvalue()}---\n{body}"

def pages(old_rev, dry):
    names = {f.stem for l in LANGS for f in (ROOT / "_extra" / l).glob("*.md")}
    done = []
    for n in sorted(names):
        cur = {l: (ROOT / f"_extra/{l}/{n}.md").read_text() if (ROOT / f"_extra/{l}/{n}.md").exists() else None for l in LANGS}
        before = {l: git_show(old_rev, f"_extra/{l}/{n}.md") for l in LANGS}
        changed = [l for l in LANGS if cur[l] is not None and cur[l] != before[l]]
        if len(changed) != 1: continue
        src = changed[0]
        if any(cur[l] is not None and before[l] is not None and cur[l] != before[l] for l in LANGS if l != src): continue
        fm, body = split_md(cur[src])
        texts = [fm[k] for k in FM_KEYS if isinstance(fm.get(k), str) and fm[k].strip()] + ([body] if body.strip() else [])
        for dst in LANGS:
            if dst == src: continue
            out = texts if dry else deepl(texts, src, dst)
            dfm, _ = split_md(cur[dst]) if cur[dst] else ({}, "")
            nfm = dict(fm); nfm.update({k: v for k, v in dfm.items() if k not in FM_KEYS})  # keep the other page's own image etc.
            i = 0
            for k in FM_KEYS:
                if isinstance(fm.get(k), str) and fm[k].strip(): nfm[k] = out[i]; i += 1
            nbody = out[i] if body.strip() else ""
            if not dry:
                (ROOT / f"_extra/{dst}").mkdir(parents=True, exist_ok=True)
                (ROOT / f"_extra/{dst}/{n}.md").write_text(join_md(nfm, nbody))
            done.append(f"page {n}: {src.upper()} → {dst.upper()}")
    return done

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    if not args: raise SystemExit(__doc__)
    old = args[0]
    done = i18n(old, dry) + pages(old, dry)
    print("\n".join(done) or "Nothing to translate.")
    Path(os.environ.get("TRANSLATED_LIST", "/dev/null")).write_text("\n".join(done))
