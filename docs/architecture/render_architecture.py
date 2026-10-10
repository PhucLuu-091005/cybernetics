"""Regenerate the documentation diagram; requires Pillow and a TrueType font."""
from pathlib import Path
import math
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
FONTS = [
    Path('/System/Library/Fonts/Supplemental/Arial.ttf'),
    Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),
]
FONT = next((path for path in FONTS if path.exists()), None)
if FONT is None:
    raise SystemExit('Provide an Arial or DejaVuSans TrueType font in FONTS.')

im = Image.new('RGB', (1600, 1040), '#f5f6f8')
d = ImageDraw.Draw(im)
INK, MUTED, BLUE, GREEN = '#172638', '#526579', '#2366a0', '#277563'


def text(x, y, value, size=22, color=INK):
    d.text((x, y), value, font=ImageFont.truetype(str(FONT), size), fill=color)


def box(rect, title, lines=(), fill='white', outline='#cbd5df', title_size=25):
    d.rounded_rectangle(rect, radius=12, fill=fill, outline=outline, width=2)
    x, y, _, _ = rect
    text(x + 22, y + 15, title, title_size)
    for i, line in enumerate(lines):
        text(x + 22, y + 55 + i * 27, line, 20, MUTED)


def arrow(points, color=BLUE):
    d.line(points, fill=color, width=4, joint='curve')
    a, b = points[-2:]
    angle = math.atan2(b[1] - a[1], b[0] - a[0])
    length = 13
    d.polygon([b, (b[0] - length * math.cos(angle - .5), b[1] - length * math.sin(angle - .5)),
               (b[0] - length * math.cos(angle + .5), b[1] - length * math.sin(angle + .5))], fill=color)


text(80, 22, 'THE INVESTIGATOR  /  SELECTED ARCHITECTURE', 32)
text(80, 60, 'One public application + one private worker + PostgreSQL', 22, MUTED)
box((80, 110, 420, 205), 'Human browser', ['Entry, inspection and review'])
box((500, 110, 860, 205), 'External agent', ['Own connectors; MCP client'])
box((960, 110, 1520, 240), 'Clerk identity and OAuth', [
    'Verified user, client, scopes and resource', 'Identity service; not case-policy authority'])
d.rounded_rectangle((80, 270, 860, 670), radius=18, fill='#edf4fb', outline=BLUE, width=3)
text(110, 286, 'NEXT.JS NODE APPLICATION', 27, BLUE)
text(110, 321, 'TLS ingress · same-origin UI · bounded requests', 20, MUTED)
box((120, 365, 420, 420), 'REST /v1', title_size=23)
box((500, 365, 800, 420), 'MCP /mcp', title_size=23)
box((120, 465, 800, 525), 'Verified ActorContext', title_size=24)
box((120, 565, 800, 650), 'Shared use cases and current policy',
    ['Domain code shared with the worker'], title_size=24)
arrow([(250, 205), (250, 240), (100, 240), (100, 392), (120, 392)])
arrow([(680, 205), (680, 240), (840, 240), (840, 392), (800, 392)])
arrow([(270, 420), (270, 465)])
arrow([(650, 420), (650, 465)])
arrow([(450, 525), (450, 565)])
arrow([(800, 495), (900, 495), (900, 175), (960, 175)])
box((960, 295, 1520, 450), 'Approved analysis provider', [
    'Only permitted bounded evidence is disclosed', 'External retention must be documented'],
    outline='#b5cfc4', fill='#eef7f1')
d.rounded_rectangle((960, 540, 1520, 950), radius=18, fill='#eef7f1', outline=GREEN, width=3)
text(990, 558, 'PRIVATE NODE WORKER', 27, GREEN)
box((1000, 610, 1480, 665), 'Lease job metadata', title_size=24)
box((1000, 710, 1480, 765), 'Recheck actor and disclosure', title_size=24)
box((1000, 810, 1480, 905), 'Extract, validate, recheck and save',
    ['No DB transaction held during model calls'], title_size=23)
arrow([(1230, 665), (1230, 710)], GREEN)
arrow([(1230, 765), (1230, 810)], GREEN)
arrow([(1480, 855), (1560, 855), (1560, 370), (1520, 370)], GREEN)
box((80, 760, 860, 950), 'POSTGRESQL', [
    'Evidence + private small originals + current permissions',
    'Snapshots + citations + audit + durable jobs',
    'RLS; short transactions; separate least-privilege roles'], outline=BLUE, title_size=27)
arrow([(450, 650), (450, 760)])
arrow([(860, 820), (920, 820), (920, 637), (1000, 637)], GREEN)
arrow([(1000, 738), (900, 738), (900, 890), (860, 890)], GREEN)
text(80, 985, 'Case/model disclosure is enforced in shared domain services, not by the LLM or browser.', 23)
im.save(ROOT / 'investigator-selected-architecture.png')
