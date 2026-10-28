"""Motion curves from a frame-stepped run (STYLE_GUIDE 4: no pops, no jitter).

motion_plot.py <motion.json> <out_prefix>
Writes <out_prefix>.png (position and speed per element) and <out_prefix>.json
(per-element stats), and prints a one-line summary per element.

A "pop" is a single-frame jump far larger than the element's own typical
motion (> 6x its 95th-percentile frame step and > 0.02 stage units), outside
scene cuts and fades. Jitter is reported as the RMS of the second difference
(acceleration) relative to speed.
"""
import json
import math
import sys

from PIL import Image, ImageDraw, ImageFont

ELEMENTS = [
    ('rabbit', 'Rabbit (x, y)', (240, 196, 120)),
    ('wolf', 'Moon Wolf (x, y)', (200, 170, 140)),
    ('firefly', 'Firefly (x, y)', (255, 230, 120)),
    ('hand', 'Demo hand fingertip shadow (s, t)', (160, 200, 255)),
    ('croc', 'Crocodile eye overlay (s, t)', (150, 230, 160)),
]


def font(size):
    for name in ('georgia.ttf', 'DejaVuSans.ttf', 'arial.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def segments(samples, key):
    """Runs of consecutive frames where the element is present, cut at scene changes and fades."""
    runs, cur = [], []
    prev_scene = None
    prev_id = None
    for i, s in enumerate(samples):
        v = s.get(key)
        ident = s.get(key + 'Id')
        cut = s['scene'] != prev_scene or s['fade'] > 0.35 or ident != prev_id
        prev_scene = s['scene']
        prev_id = ident
        # only what can be seen: positions on the stage
        if v is not None and (abs(v[0]) > 0.9 or abs(v[1]) > 0.65):
            v = None
        if v is None or cut:
            if len(cur) > 3:
                runs.append(cur)
            cur = []
            continue
        cur.append((s['t'], v[0], v[1]))
    if len(cur) > 3:
        runs.append(cur)
    return runs


def stats(runs, fps):
    steps, accs = [], []
    for run in runs:
        for i in range(1, len(run)):
            steps.append(math.hypot(run[i][1] - run[i - 1][1], run[i][2] - run[i - 1][2]))
        for i in range(2, len(run)):
            ax = run[i][1] - 2 * run[i - 1][1] + run[i - 2][1]
            ay = run[i][2] - 2 * run[i - 1][2] + run[i - 2][2]
            accs.append(math.hypot(ax, ay) * fps * fps)
    if not steps:
        return None
    ss = sorted(steps)
    p95 = ss[int(0.95 * (len(ss) - 1))]
    limit = max(0.02, 6 * p95)
    pops = sum(1 for d in steps if d > limit)
    speeds = [d * fps for d in steps]
    rms_acc = math.sqrt(sum(a * a for a in accs) / len(accs)) if accs else 0
    return {
        'frames': len(steps) + len(runs),
        'max_step': round(max(steps), 4),
        'p95_step': round(p95, 4),
        'pops': pops,
        'max_speed': round(max(speeds), 3),
        'rms_accel': round(rms_acc, 3),
    }


def plot(samples, out_png, fps):
    W, ROW = 1800, 230
    img = Image.new('RGB', (W, ROW * len(ELEMENTS) + 40), (22, 16, 12))
    d = ImageDraw.Draw(img)
    f = font(20)
    t_end = samples[-1]['t'] if samples else 1
    L, R = 70, W - 20
    X = lambda t: L + (R - L) * t / max(1e-6, t_end)
    for row, (key, label, col) in enumerate(ELEMENTS):
        y0 = 30 + row * ROW
        d.text((L, y0 - 2), label, fill=(255, 232, 196), font=f)
        top, h = y0 + 26, (ROW - 60) // 2
        d.rectangle((L, top, R, top + h), outline=(70, 55, 45))
        d.rectangle((L, top + h + 6, R, top + 2 * h + 6), outline=(70, 55, 45))
        d.text((8, top + 4), 'pos', fill=(160, 140, 120), font=font(16))
        d.text((8, top + h + 10), 'speed', fill=(160, 140, 120), font=font(16))
        runs = segments(samples, key)
        if not runs:
            continue
        vals = [p for run in runs for p in run]
        lo = min(min(v[1], v[2]) for v in vals)
        hi = max(max(v[1], v[2]) for v in vals)
        span = max(1e-3, hi - lo)
        Yp = lambda v: top + h - 4 - (h - 8) * (v - lo) / span
        smax = 1e-3
        for run in runs:
            for i in range(1, len(run)):
                smax = max(smax, math.hypot(run[i][1] - run[i - 1][1], run[i][2] - run[i - 1][2]) * fps)
        Ys = lambda v: top + 2 * h + 2 - (h - 8) * v / smax
        for run in runs:
            for comp, c in ((1, col), (2, tuple(int(x * 0.6) for x in col))):
                pts = [(X(p[0]), Yp(p[comp])) for p in run]
                if len(pts) > 1:
                    d.line(pts, fill=c, width=2)
            sp = [(X(run[i][0]), Ys(math.hypot(run[i][1] - run[i - 1][1], run[i][2] - run[i - 1][2]) * fps)) for i in range(1, len(run))]
            if len(sp) > 1:
                d.line(sp, fill=(220, 120, 90), width=2)
        d.text((R - 260, top + h + 10), f'max {smax:.2f} units/s', fill=(200, 160, 130), font=font(16))
    # time axis
    for t in range(0, int(t_end) + 1, 5):
        d.text((X(t) - 8, img.height - 22), f'{t}s', fill=(150, 130, 110), font=font(14))
    img.save(out_png)


def main():
    data = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    fps = data['fps']
    samples = data['samples']
    report = {}
    for key, label, _ in ELEMENTS:
        st = stats(segments(samples, key), fps)
        report[key] = st
        if st:
            print(f"MOTION {key:8s} frames {st['frames']:5d}  pops {st['pops']}  max step {st['max_step']:.4f}  p95 step {st['p95_step']:.4f}  max speed {st['max_speed']:.2f}/s  rms accel {st['rms_accel']:.2f}")
    json.dump(report, open(out + '.json', 'w'), indent=2)
    plot(samples, out + '.png', fps)


if __name__ == '__main__':
    main()
