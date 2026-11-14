"""Prepare photos uploaded from the admin.

  python3 tools/photos.py [changed files…]

Before anything is resized or cropped, the untouched original is copied to
source-images/<lg|members>/ (originals are never cropped; only web sizes are).

- assets/img/lg/*      : shrinks anything bigger than 1800 px (long side) and makes the
                         small copy in assets/img/sm/ (820 px long side, same name).
- assets/img/members/* : crops to a centred square and resizes to 500 × 500.
Only the files given (the ones changed in the last push) are touched, plus any
lg photo that has no sm copy yet. Run by .github/workflows/photos.yml."""
import shutil, sys
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
LG, SM, MEM = ROOT / "assets/img/lg", ROOT / "assets/img/sm", ROOT / "assets/img/members"
SRC = ROOT / "source-images"
EXT = {".jpg", ".jpeg", ".png", ".webp"}
changed = {(ROOT / p).resolve() for p in sys.argv[1:]}


def save(im, path):
    fmt = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".webp": "WEBP"}[path.suffix.lower()]
    if fmt == "JPEG" and im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    opts = {"quality": 82, "optimize": True, "progressive": True} if fmt == "JPEG" else {"quality": 82} if fmt == "WEBP" else {"optimize": True}
    im.save(path, fmt, **opts)
    print("  wrote", path.relative_to(ROOT))


def keep_original(f, sub):
    dst = SRC / sub / f.name
    if f.resolve() in changed and (not dst.exists() or dst.read_bytes() != f.read_bytes()):
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dst)
        print("  kept original", dst.relative_to(ROOT))


def fit(im, long_side):
    w, h = im.size
    s = long_side / max(w, h)
    return im if s >= 1 else im.resize((round(w * s), round(h * s)), Image.LANCZOS)


for f in sorted(LG.iterdir()):
    if f.suffix.lower() not in EXT:
        continue
    sm = SM / f.name
    if f.resolve() not in changed and sm.exists():
        continue
    keep_original(f, "lg")
    im = ImageOps.exif_transpose(Image.open(f))
    if max(im.size) > 1800:
        im = fit(im, 1800)
        save(im, f)
    save(fit(im, 820), sm)

for f in sorted(MEM.iterdir()):
    if f.suffix.lower() not in EXT or f.resolve() not in changed:
        continue
    keep_original(f, "members")
    im = ImageOps.exif_transpose(Image.open(f))
    if im.size != (500, 500):
        save(ImageOps.fit(im, (500, 500), Image.LANCZOS, centering=(0.5, 0.4)), f)
