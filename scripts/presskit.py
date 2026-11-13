"""Builds the press kit PDFs (CA / ES / EN) from the website's own data.

   Needs: Jekyll (gem install jekyll -v '~> 3.10') and Playwright with Chrome
          (pip install playwright && playwright install chromium)
   Run from the repo root:   python scripts/presskit.py ../lasenyal-docs/pdf
   Then commit the PDFs in lasenyal-docs.

   The press kit page itself is at /presskit/<lang>/ — edit _layouts/presskit.html for the layout,
   and the texts (pk_* keys) in _data/i18n/<lang>.yml. Members and concerts come from _data/."""
import os, pathlib, subprocess, sys, tempfile, threading, functools, http.server
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else root.parent / "lasenyal-docs" / "pdf").resolve()
out.mkdir(parents=True, exist_ok=True)
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
    for lang in ("ca", "es", "en"):
        pg.goto(f"http://127.0.0.1:{port}/lasenyal-web/presskit/{lang}/", wait_until="networkidle")
        pg.evaluate("document.fonts.ready")
        pg.wait_for_timeout(500)
        dest = out / f"lasenyal-presskit-{lang}.pdf"
        pg.pdf(path=str(dest), width="1280px", height="720px", print_background=True, prefer_css_page_size=True)
        print("✓", dest, f"{dest.stat().st_size / 1e6:.1f} MB")
    b.close()
srv.shutdown()
