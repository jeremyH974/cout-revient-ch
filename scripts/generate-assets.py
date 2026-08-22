"""Génère les icônes PWA et l'image Open Graph (Pillow). Usage : python scripts/generate-assets.py"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path('public')
BG, ACCENT, GAIN, FG, MUTED = (15, 17, 21, 255), (91, 141, 239, 255), (74, 222, 128, 255), (231, 233, 238, 255), (154, 163, 178, 255)
PTS = [(14, 42), (26, 28), (36, 36), (50, 18)]  # grille 64 (cf. favicon.svg)


def draw_mark(img, box, stroke_scale=1.0):
    x0, y0, x1, y1 = box
    s = (x1 - x0) / 64
    d = ImageDraw.Draw(img)
    pts = [(x0 + x * s, y0 + y * s) for x, y in PTS]
    w = max(2, int(6 * s * stroke_scale))
    d.line(pts, fill=ACCENT, width=w, joint='curve')
    for p in (pts[0], pts[-1]):
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=ACCENT)
    r = 5 * s
    d.ellipse([pts[-1][0] - r, pts[-1][1] - r, pts[-1][0] + r, pts[-1][1] + r], fill=GAIN)


def icon(size, maskable=False, rounded=True):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable or not rounded:
        d.rectangle([0, 0, size, size], fill=BG)
    else:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=BG)
    pad = size * (0.22 if maskable else 0.12)
    draw_mark(img, (pad, pad, size - pad, size - pad))
    return img


def font(bold, size):
    for name in (['segoeuib.ttf', 'arialbd.ttf'] if bold else ['segoeui.ttf', 'arial.ttf']):
        try:
            return ImageFont.truetype(f'C:/Windows/Fonts/{name}', size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def og():
    img = Image.new('RGB', (1200, 630), BG[:3])
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 14, 630], fill=ACCENT)
    draw_mark(img, (860, 150, 1120, 410), 0.9)
    d.text((80, 120), 'Coût de revient CH', font=font(True, 72), fill=FG)
    d.text((80, 230), 'Votre PRU par crypto, enfin lisible.', font=font(False, 40), fill=FG)
    y = 330
    for line in ('Importez votre export Coinhouse :', 'PRU tenant compte des ventes, plus-values réalisées', 'et latentes, par ligne et au total.'):
        d.text((80, y), line, font=font(False, 30), fill=MUTED)
        y += 42
    d.text((80, 540), 'Gratuit · privé · sans compte · 100 % dans votre navigateur', font=font(True, 26), fill=GAIN)
    return img


OUT.mkdir(exist_ok=True)
icon(192).save(OUT / 'pwa-192x192.png')
icon(512).save(OUT / 'pwa-512x512.png')
icon(512, maskable=True).save(OUT / 'maskable-icon-512x512.png')
icon(180, rounded=False).convert('RGB').save(OUT / 'apple-touch-icon-180x180.png')
icon(64).save(OUT / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
og().save(OUT / 'og-image.png', optimize=True)
print('assets generated:', sorted(p.name for p in OUT.glob('*.png')) + ['favicon.ico'])
