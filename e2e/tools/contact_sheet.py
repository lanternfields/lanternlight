"""Labelled contact sheet of PNG stills: contact_sheet.py <dir> <out.png> [columns]
Also: contact_sheet.py --pairs <before_dir> <after_dir> <out.png> (side-by-side rows)."""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

THUMB_W = 640


def font(size):
    for name in ('georgia.ttf', 'DejaVuSans.ttf', 'arial.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def thumb(path):
    im = Image.open(path).convert('RGB')
    h = round(im.height * THUMB_W / im.width)
    return im.resize((THUMB_W, h), Image.LANCZOS)


def label(im, text):
    d = ImageDraw.Draw(im)
    f = font(22)
    d.rectangle((0, 0, im.width, 34), fill=(12, 8, 6))
    d.text((10, 5), text, fill=(255, 232, 196), font=f)
    return im


def stills(folder):
    return sorted(f for f in os.listdir(folder) if f.endswith('.png') and f[0:2].isdigit())


def sheet(folder, out, cols):
    files = stills(folder)
    ims = [label(thumb(os.path.join(folder, f)), f[3:-4]) for f in files]
    if not ims:
        return
    h = ims[0].height
    rows = (len(ims) + cols - 1) // cols
    canvas = Image.new('RGB', (cols * THUMB_W + (cols + 1) * 8, rows * h + (rows + 1) * 8), (24, 18, 14))
    for i, im in enumerate(ims):
        canvas.paste(im, (8 + (i % cols) * (THUMB_W + 8), 8 + (i // cols) * (h + 8)))
    canvas.save(out)


def pairs(before, after, out):
    names = {f[3:]: f for f in stills(before)}
    rows = []
    for f in stills(after):
        key = f[3:]
        if key in names:
            rows.append((label(thumb(os.path.join(before, names[key])), 'BEFORE  ' + key[:-4]), label(thumb(os.path.join(after, f)), 'AFTER  ' + key[:-4])))
    if not rows:
        return
    h = rows[0][0].height
    canvas = Image.new('RGB', (2 * THUMB_W + 24, len(rows) * (h + 8) + 8), (24, 18, 14))
    for i, (a, b) in enumerate(rows):
        canvas.paste(a, (8, 8 + i * (h + 8)))
        canvas.paste(b, (16 + THUMB_W, 8 + i * (h + 8)))
    canvas.save(out)


if __name__ == '__main__':
    if sys.argv[1] == '--pairs':
        pairs(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        sheet(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 4)
