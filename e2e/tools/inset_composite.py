"""Picture-in-picture for recordings: inset_composite.py <frames_dir> <insets_dir>

Each inset (a side view of the hand and the lantern, rendered at the same
instant as its frame) is scaled down and placed in the upper-left corner of
the frame (clear of the stage's banks, reeds and characters, and of the
storyteller's ribbon in the middle), with
a thin warm frame, a soft drop shadow and a small "your hand" label; its
opacity follows the director's eased inset weight (insets_dir/alpha.json).
Frames are rewritten in place (JPEG).
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

frames_dir, insets_dir = sys.argv[1], sys.argv[2]
alpha = json.load(open(os.path.join(insets_dir, 'alpha.json')))


def font(size):
    for name in ('georgiai.ttf', 'georgia.ttf', 'DejaVuSerif-Italic.ttf', 'arial.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


LABEL = font(26)
for key, a in alpha.items():
    idx = int(key)
    fpath = os.path.join(frames_dir, f'{idx:06d}.jpg')
    ipath = os.path.join(insets_dir, f'{idx:06d}.jpg')
    if not (os.path.exists(fpath) and os.path.exists(ipath)):
        continue
    frame = Image.open(fpath).convert('RGB')
    W, H = frame.size
    iw = int(W * 0.25)
    ih = int(iw * 9 / 16)
    inset = Image.open(ipath).convert('RGB').resize((iw, ih), Image.LANCZOS)
    margin = int(W * 0.022)
    x0 = margin
    y0 = margin
    # card: shadow, warm frame, the inset, a label
    card = Image.new('RGBA', (iw + 8, ih + 8), (242, 214, 160, 255))
    card.paste(inset, (4, 4))
    d = ImageDraw.Draw(card)
    d.rectangle((4, ih - 36, 4 + 150, ih + 4), fill=(14, 9, 6, 200))
    d.text((14, ih - 34), 'your hand', fill=(255, 232, 190, 255), font=LABEL)
    shadow = Image.new('RGBA', (iw + 48, ih + 48), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rectangle((20, 20, iw + 28, ih + 28), fill=(0, 0, 0, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(10))
    k = max(0.0, min(1.0, float(a)))
    layer = Image.new('RGBA', frame.size, (0, 0, 0, 0))
    layer.alpha_composite(shadow, (x0 - 24, y0 - 20))
    layer.alpha_composite(card, (x0 - 4, y0 - 4))
    if k < 1:
        r, g, b, al = layer.split()
        al = al.point(lambda v: int(v * k))
        layer = Image.merge('RGBA', (r, g, b, al))
    out = Image.alpha_composite(frame.convert('RGBA'), layer).convert('RGB')
    out.save(fpath, quality=92)
