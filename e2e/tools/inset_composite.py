"""Picture-in-picture for recordings: inset_composite.py <frames_dir> <insets_dir>

Each inset (a side view of the hand and the lantern, rendered at the same
instant as its frame) is scaled down and placed in the upper-left corner of
the frame (clear of the stage's banks, reeds and characters), with a thin warm
frame, a soft drop shadow and a small "your hand" label; its opacity follows
the director's eased inset weight (insets_dir/alpha.json).

It always keeps a gap from the storyteller's ribbon: the capture logs the
ribbon's size per frame (insets_dir/ribbon.json, stage units), and where the
ribbon would come within the gap the inset shrinks just enough, easing in a
few frames ahead so it never jumps. Frames are rewritten in place (JPEG).
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

frames_dir, insets_dir = sys.argv[1], sys.argv[2]
alpha = json.load(open(os.path.join(insets_dir, 'alpha.json')))
rpath = os.path.join(insets_dir, 'ribbon.json')
ribbon = json.load(open(rpath)) if os.path.exists(rpath) else {}

# the close shot's framing (e2e/lib.mjs aimAtStage): the stage fills 0.67 of
# the frame height, with stage t = -0.06 at the frame's centre; the ribbon is
# centred at stage (0, 0.37) (src/app.ts RIBBON_SPOTS)
FILL = 0.67
CENTRE_T = -0.06
RIBBON_T = 0.37


def font(size):
    for name in ('georgiai.ttf', 'georgia.ttf', 'DejaVuSerif-Italic.ttf', 'arial.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def max_width(key, W, H, x0, y0, full_w, gap):
    """The widest inset (px) at (x0, y0) that keeps `gap` from this frame's ribbon."""
    r = ribbon.get(key)
    if not r or r[2] > 0.02:  # no ribbon, or a wide shot (another framing)
        return full_w
    cw, ch = r[0], r[1]
    unit = FILL * H
    left = W / 2 - cw / 2 * unit
    top = H / 2 - (RIBBON_T + ch / 2 - CENTRE_T) * unit
    bottom = H / 2 - (RIBBON_T - ch / 2 - CENTRE_T) * unit
    full_h = full_w * 9 / 16
    if y0 > bottom + gap or y0 + full_h < top - gap:
        return full_w
    return max(W * 0.16, min(full_w, left - gap - x0))


keys = sorted(alpha.keys(), key=int)
first = Image.open(os.path.join(frames_dir, f'{int(keys[0]):06d}.jpg')) if keys else None
if first is not None:
    W, H = first.size
    margin = int(W * 0.022)
    gap = W * 0.02
    full_w = W * 0.25
    targets = [max_width(k, W, H, margin, margin, full_w, gap) for k in keys]
    widths = []
    cur = full_w
    for i in range(len(keys)):
        # look ahead ~0.2 s: shrink before the ribbon arrives, never after
        ahead = min(targets[i:i + 12])
        cur += (ahead - cur) * 0.25
        # (and never wider than this frame itself allows)
        cur = min(cur, targets[i])
        widths.append(cur)

    for key, w in zip(keys, widths):
        a = alpha[key]
        idx = int(key)
        fpath = os.path.join(frames_dir, f'{idx:06d}.jpg')
        ipath = os.path.join(insets_dir, f'{idx:06d}.jpg')
        if not (os.path.exists(fpath) and os.path.exists(ipath)):
            continue
        frame = Image.open(fpath).convert('RGB')
        iw = int(w)
        ih = int(iw * 9 / 16)
        inset = Image.open(ipath).convert('RGB').resize((iw, ih), Image.LANCZOS)
        x0 = margin
        y0 = margin
        s = iw / (W * 0.25)
        label = font(max(14, int(26 * s)))
        # card: shadow, warm frame, the inset, a label
        card = Image.new('RGBA', (iw + 8, ih + 8), (242, 214, 160, 255))
        card.paste(inset, (4, 4))
        d = ImageDraw.Draw(card)
        d.rectangle((4, ih - int(36 * s), 4 + int(150 * s), ih + 4), fill=(14, 9, 6, 200))
        d.text((4 + int(10 * s), ih - int(34 * s)), 'your hand', fill=(255, 232, 190, 255), font=label)
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
