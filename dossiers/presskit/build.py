"""Builds the press kit PDFs (CA / ES / EN) from the website's own data.

   Source: the page /presskit/<lang>/ = _layouts/presskit.html + texts (pk_* keys) in
   _data/i18n/<lang>.yml + members and concerts from _data/. Never edit the PDFs by hand.

   Needs: Jekyll (gem install jekyll -v '~> 3.10') and Playwright with Chrome
          (pip install playwright && playwright install chromium)
   Run from the repo root:   python3 dossiers/presskit/build.py [ca es en]
   Writes  pdf/LaSenyal_<LANG>_presskit_<yyyy-mm>.pdf  and points _data/downloads.yml
   (the short links /dossier/<lang>/) at the new files. Then: tools/check.py, update
   INDEX.md in lasenyal-docs, commit, push. Only rebuild a language whose text changed."""
import datetime, os, pathlib, re, subprocess, sys, tempfile, threading, functools, http.server
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parents[2]
out = root / "pdf"
out.mkdir(exist_ok=True)
langs = sys.argv[1:] or ["ca", "es", "en"]
stamp = datetime.date.today().strftime("%Y-%m")
build = pathlib.Path(tempfile.mkdtemp())
site = build / "lasenyal-web"
env = {**os.environ, "JEKYLL_NO_BUNDLER_REQUIRE": "true"}
subprocess.run(["jekyll", "build", "-q", "-s", str(root), "-d", str(site), "--baseurl", "/lasenyal-web"], check=True, env=env)

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(build))
handler.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
port = srv.server_address[1]

chrome = next((p for p in ("/usr/bin/google-chrome", "/usr/bin/chromium") if os.path.exists(p)), None)
with sync_playwright() as p:
    b = p.chromium.launch(**({"executable_path": chrome} if chrome else {}), args=["--no-sandbox"])
    pg = b.new_page(viewport={"width": 1280, "height": 720})
    for lang in langs:
        pg.goto(f"http://127.0.0.1:{port}/lasenyal-web/presskit/{lang}/", wait_until="networkidle")
        pg.evaluate("document.fonts.ready")
        pg.wait_for_timeout(500)
        dest = out / f"LaSenyal_{lang.upper()}_presskit_{stamp}.pdf"
        pg.pdf(path=str(dest), width="1280px", height="720px", print_background=True, prefer_css_page_size=True)
        print("✓", dest.relative_to(root), f"{dest.stat().st_size / 1e6:.1f} MB")
        dl = root / "_data/downloads.yml"
        txt = dl.read_text()
        txt = re.sub(rf"(?m)^(  {lang}: ).*$", rf"\g<1>/pdf/{dest.name}", txt, count=1)
        dl.write_text(txt)
    b.close()
srv.shutdown()
