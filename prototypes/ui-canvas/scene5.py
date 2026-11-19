"""Direction B v5: realistic vector airfield. 1 tile = 8 units. Taxiways fit Large wingspans."""
import random

WW, WH = 360, 248
TILE = 8
TW = 20   # taxiway width (Large wingspan 18 fits)
C = dict(grass='#0f1a15', grass2='#0c1511', grass3='#12201a', concrete='#232d29', joint='#2c3833', asphalt='#1a2024', asphaltEdge='#131819',
         yellow='#c9a227', white='#b9c5c7', red='#b3392f', wall='#151c19', roof='#27322d', roofEdge='#33413b', glass='#2c6f69', glassHi='#4fa39b',
         cargo='#2f2823', cargo2='#3a312a', shadow='rgba(0,0,0,0.45)', tail1='#38d0b0', tail2='#f2a33a', tail3='#7aa7ff', tail4='#e86f63',
         edgeBlue='#4aa3ff', edgeWhite='#e6f0f2', green='#5ff28a', tree='#10261a', treeHi='#163223', label='#7f9a92', fence='#2f3d37',
         fireRed='#c0392b', fireRoof='#4a1f1b')

DEFS = ('<defs>'
        '<linearGradient id="fus" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#aebdb8"></stop><stop offset="0.45" stop-color="#f4faf8"></stop>'
        '<stop offset="0.55" stop-color="#f4faf8"></stop><stop offset="1" stop-color="#aebdb8"></stop></linearGradient>'
        '<linearGradient id="wing" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9d6d2"></stop><stop offset="1" stop-color="#93a39e"></stop></linearGradient>'
        '<linearGradient id="eng" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5d6a66"></stop><stop offset="0.5" stop-color="#9aa8a4"></stop><stop offset="1" stop-color="#5d6a66"></stop></linearGradient>'
        '</defs>')

# --- aircraft shapes, nose up, length 40 (y -20..20)
def _narrow(tail):
    return ('<path d="M2.1,-3 L18.5,7.6 L18.8,9.4 L2.1,4.6 Z M-2.1,-3 L-18.5,7.6 L-18.8,9.4 L-2.1,4.6 Z" fill="url(#wing)"></path>'
            '<path d="M18.2,7.2 L19.3,6.4 L19.4,8.8 Z M-18.2,7.2 L-19.3,6.4 L-19.4,8.8 Z" fill="#93a39e"></path>'
            '<path d="M1.6,13.5 L7.6,17.6 L7.6,19 L1.3,17.4 Z M-1.6,13.5 L-7.6,17.6 L-7.6,19 L-1.3,17.4 Z" fill="url(#wing)"></path>'
            '<ellipse cx="7.6" cy="0.6" rx="1.35" ry="3" fill="url(#eng)"></ellipse><ellipse cx="-7.6" cy="0.6" rx="1.35" ry="3" fill="url(#eng)"></ellipse>'
            '<path d="M0,-20 C1.5,-19.6 2.2,-17.5 2.2,-14 L2.2,12 C2.2,15.5 1.2,18.5 0,20 C-1.2,18.5 -2.2,15.5 -2.2,12 L-2.2,-14 C-2.2,-17.5 -1.5,-19.6 0,-20 Z" fill="url(#fus)"></path>'
            '<path d="M-1.3,-17.6 Q0,-18.4 1.3,-17.6 L1.2,-16.8 Q0,-17.4 -1.2,-16.8 Z" fill="#0d1513"></path>'
            f'<path d="M0,12.5 L0,19.6" stroke="{tail}" stroke-width="1.3" stroke-linecap="round"></path>')


def _wide(tail):
    return ('<path d="M3,-4 L20,8.6 L20.2,10.6 L3,5.4 Z M-3,-4 L-20,8.6 L-20.2,10.6 L-3,5.4 Z" fill="url(#wing)"></path>'
            '<path d="M2.2,13 L9,17.2 L9,18.8 L1.8,17.2 Z M-2.2,13 L-9,17.2 L-9,18.8 L-1.8,17.2 Z" fill="url(#wing)"></path>'
            '<ellipse cx="8.6" cy="0.2" rx="2" ry="3.8" fill="url(#eng)"></ellipse><ellipse cx="-8.6" cy="0.2" rx="2" ry="3.8" fill="url(#eng)"></ellipse>'
            '<path d="M0,-20 C2.2,-19.4 3.1,-17 3.1,-13 L3.1,11 C3.1,15 1.6,18.6 0,20 C-1.6,18.6 -3.1,15 -3.1,11 L-3.1,-13 C-3.1,-17 -2.2,-19.4 0,-20 Z" fill="url(#fus)"></path>'
            '<path d="M-1.8,-17.4 Q0,-18.4 1.8,-17.4 L1.7,-16.4 Q0,-17.2 -1.7,-16.4 Z" fill="#0d1513"></path>'
            f'<path d="M0,12 L0,19.6" stroke="{tail}" stroke-width="1.6" stroke-linecap="round"></path>')


def _jumbo(tail):
    return ('<path d="M3,-5 L20,8 L20.2,10 L3,4.4 Z M-3,-5 L-20,8 L-20.2,10 L-3,4.4 Z" fill="url(#wing)"></path>'
            '<path d="M2.2,13 L9,17.2 L9,18.8 L1.8,17.2 Z M-2.2,13 L-9,17.2 L-9,18.8 L-1.8,17.2 Z" fill="url(#wing)"></path>'
            '<ellipse cx="7.4" cy="-0.6" rx="1.6" ry="3.2" fill="url(#eng)"></ellipse><ellipse cx="-7.4" cy="-0.6" rx="1.6" ry="3.2" fill="url(#eng)"></ellipse>'
            '<ellipse cx="13.4" cy="3.6" rx="1.5" ry="3" fill="url(#eng)"></ellipse><ellipse cx="-13.4" cy="3.6" rx="1.5" ry="3" fill="url(#eng)"></ellipse>'
            '<path d="M0,-20 C2.4,-19.4 3.2,-17 3.2,-13 L3.1,11 C3.1,15 1.6,18.6 0,20 C-1.6,18.6 -3.1,15 -3.1,11 L-3.2,-13 C-3.2,-17 -2.4,-19.4 0,-20 Z" fill="url(#fus)"></path>'
            '<path d="M0,-17 C1.6,-16.6 2,-14 2,-10 L1.4,-6 L-1.4,-6 L-2,-10 C-2,-14 -1.6,-16.6 0,-17 Z" fill="#e6efec"></path>'
            f'<path d="M0,12 L0,19.6" stroke="{tail}" stroke-width="1.6" stroke-linecap="round"></path>')


def _prop(tail):
    return ('<path d="M1.8,-7 L19,-6 L19,-3.4 L1.8,-2.6 Z M-1.8,-7 L-19,-6 L-19,-3.4 L-1.8,-2.6 Z" fill="url(#wing)"></path>'
            '<rect x="6" y="-11" width="2.6" height="8" rx="1.2" fill="url(#eng)"></rect><rect x="-8.6" y="-11" width="2.6" height="8" rx="1.2" fill="url(#eng)"></rect>'
            '<path d="M3.2,-11.4 L11.4,-11.4 M-3.2,-11.4 L-11.4,-11.4" stroke="#c9d6d2" stroke-width="0.5" opacity="0.7"></path>'
            '<path d="M0,-20 C1.5,-19.6 2,-17.5 2,-14 L2,12 C2,15.5 1,18.5 0,20 C-1,18.5 -2,15.5 -2,12 L-2,-14 C-2,-17.5 -1.5,-19.6 0,-20 Z" fill="url(#fus)"></path>'
            '<path d="M0,15 L7,17 L7,18.6 L0,17.6 L-7,18.6 L-7,17 Z" fill="url(#wing)"></path>'
            '<path d="M-1.1,-17.8 Q0,-18.4 1.1,-17.8 L1,-17 Q0,-17.5 -1,-17 Z" fill="#0d1513"></path>'
            f'<path d="M0,12 L0,17.4" stroke="{tail}" stroke-width="1.2" stroke-linecap="round"></path>')


SHAPES = {'prop': _prop, 'narrow': _narrow, 'wide': _wide, 'jumbo': _jumbo}
LEN = {'prop': 9, 'narrow': 13, 'wide': 18, 'jumbo': 18}
ROT = {'N': 0, 'E': 90, 'S': 180, 'W': 270}


def plane(x, y, kind, heading, tail, alt=0.5):
    s = LEN[kind] / 40
    rot = ROT[heading] if isinstance(heading, str) else heading
    body = SHAPES[kind](tail)
    shadow = SHAPES[kind]('#000').replace('url(#wing)', C['shadow']).replace('url(#fus)', C['shadow']).replace('url(#eng)', C['shadow']).replace('#0d1513', C['shadow']).replace('#93a39e', C['shadow']).replace('#e6efec', C['shadow']).replace('#c9d6d2', 'transparent').replace('stroke="#000"', f'stroke="{C["shadow"]}"')
    return (f'<g transform="translate({x + alt},{y + alt}) rotate({rot}) scale({s})">{shadow}</g>'
            f'<g transform="translate({x},{y}) rotate({rot}) scale({s})">{body}</g>')


def line(d, color=None, w=0.6, dash=None, cap='round'):
    color = color or C['yellow']
    da = f' stroke-dasharray="{dash}"' if dash else ''
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="{cap}" stroke-linejoin="round"{da}></path>'


def band(d, w=TW, color=None):
    color = color or C['asphalt']
    return (f'<path d="{d}" fill="none" stroke="{C["asphaltEdge"]}" stroke-width="{w + 1}" stroke-linecap="butt" stroke-linejoin="round"></path>'
            f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="butt" stroke-linejoin="round"></path>')


def tjunc(x, y_main, y_end, r=9, down=True):
    s = 1 if down else -1
    return (line(f'M{x - r},{y_main} Q{x},{y_main} {x},{y_main + s * r}') + line(f'M{x + r},{y_main} Q{x},{y_main} {x},{y_main + s * r}')
            + line(f'M{x},{y_main + s * r} L{x},{y_end}'))


def hold_line(x, y, w=TW):
    x0, x1 = x - w / 2 + 0.7, x + w / 2 - 0.7
    return (line(f'M{x0},{y} H{x1}', w=0.55, cap='butt') + line(f'M{x0},{y + 1.3} H{x1}', w=0.55, cap='butt')
            + line(f'M{x0},{y + 2.8} H{x1}', w=0.55, dash='1.3 0.9', cap='butt') + line(f'M{x0},{y + 4.1} H{x1}', w=0.55, dash='1.3 0.9', cap='butt'))


def sign(x, y, text):
    return (f'<rect x="{x}" y="{y}" width="15" height="5.4" rx="0.6" fill="{C["red"]}"></rect>'
            f'<text x="{x + 7.5}" y="{y + 4}" font-family="JetBrains Mono, monospace" font-size="3.8" font-weight="700" fill="#ffffff" text-anchor="middle">{text}</text>')


def label(x, y, text, anchor='middle', size=4):
    return (f'<text x="{x}" y="{y}" font-family="JetBrains Mono, monospace" font-size="{size}" font-weight="700" letter-spacing="0.6" fill="{C["label"]}" '
            f'text-anchor="{anchor}">{text}</text>')



def box(x, y, w, d, h, roof, wall, edgeHi='#3a4943', edgeLo='#141a17'):
    """Oblique box: roof w×d at (x, y), visible south wall of height h below it, shadow cast to the south-east."""
    sh = h * 0.9
    return (f'<path d="M{x + w},{y} L{x + w + sh},{y + sh * 0.55} L{x + w + sh},{y + d + h + sh * 0.55} L{x + sh},{y + d + h + sh * 0.55} L{x},{y + d + h} Z" fill="{C["shadow"]}"></path>'
            f'<rect x="{x}" y="{y + d}" width="{w}" height="{h}" fill="{wall}"></rect>'
            f'<rect x="{x}" y="{y}" width="{w}" height="{d}" fill="{roof}"></rect>'
            f'<path d="M{x},{y + d} L{x},{y} L{x + w},{y}" fill="none" stroke="{edgeHi}" stroke-width="0.7"></path>'
            f'<path d="M{x + w},{y} L{x + w},{y + d}" fill="none" stroke="{edgeLo}" stroke-width="0.7"></path>'
            f'<rect x="{x + 1.2}" y="{y + 1.2}" width="{w - 2.4}" height="{d - 2.4}" fill="none" stroke="{edgeLo}" stroke-width="0.35" opacity="0.8"></rect>')


def hvac(x, y, w=5, d=3.5):
    return (f'<rect x="{x + 0.8}" y="{y + 0.8}" width="{w}" height="{d}" fill="rgba(0,0,0,0.35)"></rect>'
            f'<rect x="{x}" y="{y}" width="{w}" height="{d}" fill="#3b4a44"></rect><circle cx="{x + w * 0.3}" cy="{y + d / 2}" r="{d * 0.32}" fill="#26302c"></circle>'
            f'<circle cx="{x + w * 0.72}" cy="{y + d / 2}" r="{d * 0.32}" fill="#26302c"></circle>')


def terminal(x, y, w=120, d=30):
    o = [box(x, y, w, d, 7, '#2a3531', '#132422')]
    for k in range(4):   # roof panels
        o.append(f'<rect x="{x + 3 + k * (w - 6) / 4:.1f}" y="{y + 3}" width="{(w - 6) / 4 - 1.5:.1f}" height="{d - 6}" fill="{"#2e3a35" if k % 2 else "#28332f"}"></rect>')
    o.append(f'<rect x="{x + 6}" y="{y + d / 2 - 1.6}" width="{w - 12}" height="3.2" fill="#24504b"></rect>')
    for xx in range(int(x + 8), int(x + w - 8), 4):
        o.append(f'<rect x="{xx}" y="{y + d / 2 - 1.6}" width="0.3" height="3.2" fill="#1a2e2b"></rect>')
    for hx in (x + 10, x + 18, x + w - 22, x + w - 14):
        o.append(hvac(hx, y + 5))
    o.append(f'<rect x="{x}" y="{y + d}" width="{w}" height="7" fill="#1c4440"></rect><rect x="{x}" y="{y + d + 1}" width="{w}" height="1.6" fill="#3f8a82" opacity="0.6"></rect>')
    for xx in range(int(x), int(x + w), 3):
        o.append(f'<rect x="{xx}" y="{y + d}" width="0.3" height="7" fill="#0f2422"></rect>')
    return ''.join(o)


def cargo_hub(x, y, w=80, d=30):
    o = [box(x, y, w, d, 6, '#2f2823', '#1a1613', '#4a3f36', '#120f0d')]
    for xx in range(int(x + 2), int(x + w - 1), 3):
        o.append(f'<rect x="{xx}" y="{y + 1.5}" width="1.4" height="{d - 3}" fill="#3a312a"></rect>')
    for vx in (x + 14, x + 34, x + 54):
        o.append(f'<circle cx="{vx}" cy="{y + 8}" r="1.6" fill="#22201d"></circle><circle cx="{vx}" cy="{y + 22}" r="1.6" fill="#22201d"></circle>')
    for k in range(6):   # loading dock doors
        o.append(f'<rect x="{x + 5 + k * 12.5}" y="{y + d + 1}" width="8" height="5" fill="#2a2420"></rect><rect x="{x + 5 + k * 12.5}" y="{y + d + 1}" width="8" height="0.8" fill="#c9a227"></rect>')
    return ''.join(o)


def fire_station(x, y):
    o = [box(x, y, 34, 12, 6, '#3d1d1a', '#1b1513', '#5e2a25', '#140c0b')]
    o.append(hvac(x + 4, y + 3, 4.5, 3))
    o.append(f'<rect x="{x + 22}" y="{y + 2.5}" width="7" height="7" fill="none" stroke="#e8d7d4" stroke-width="0.6"></rect><path d="M{x + 25.5},{y + 3.5} V{y + 8.5} M{x + 23},{y + 6} H{x + 28}" stroke="#e8d7d4" stroke-width="0.6"></path>')
    for k in range(3):   # open bay doors with truck noses
        bx = x + 2.5 + k * 10.5
        o.append(f'<rect x="{bx}" y="{y + 12.5}" width="8" height="5.5" fill="#0d0f0e"></rect>')
    o.append(f'<rect x="{x}" y="{y + 18}" width="34" height="9" fill="{C["asphalt"]}"></rect>')
    for dx in (3.5, 14):
        o.append(f'<rect x="{x + dx + 0.6}" y="{y + 19.6}" width="6" height="7" rx="0.8" fill="rgba(0,0,0,0.35)"></rect>'
                 f'<rect x="{x + dx}" y="{y + 19}" width="6" height="7" rx="0.8" fill="{C["fireRed"]}"></rect>'
                 f'<rect x="{x + dx + 0.6}" y="{y + 19.5}" width="4.8" height="1.6" fill="#2b3732"></rect>'
                 f'<rect x="{x + dx + 1}" y="{y + 21.6}" width="4" height="0.6" fill="#4aa3ff"></rect>'
                 f'<rect x="{x + dx}" y="{y + 23.5}" width="6" height="0.6" fill="#e8e1d0"></rect>')
    return ''.join(o)


def tree(x, y, r=4):
    return (f'<circle cx="{x + 1.2}" cy="{y + 1.2}" r="{r}" fill="{C["shadow"]}"></circle><circle cx="{x}" cy="{y}" r="{r}" fill="{C["tree"]}"></circle>'
            f'<circle cx="{x - r * 0.3}" cy="{y - r * 0.3}" r="{r * 0.55}" fill="{C["treeHi"]}"></circle>')


def stand(cx, size, num, y_top=72, y_lane=108):
    w = {'S': 13, 'M': 17, 'L': 22}[size]
    d = {'S': 12, 'M': 16, 'L': 21}[size]
    return (f'<rect x="{cx - w / 2}" y="{y_top + 3}" width="{w}" height="{d + 2}" fill="none" stroke="{C["red"]}" stroke-width="0.35" stroke-dasharray="1.2 1" opacity="0.8"></rect>'
            + line(f'M{cx - 9},{y_lane} Q{cx},{y_lane} {cx},{y_lane - 9} L{cx},{y_top + 5}') + line(f'M{cx + 9},{y_lane} Q{cx},{y_lane} {cx},{y_lane - 9}')
            + line(f'M{cx - 3.5},{y_top + 5} H{cx + 3.5}', w=0.9, cap='butt')
            + f'<text x="{cx - w / 2 + 1.2}" y="{y_top + 7.4}" font-family="JetBrains Mono, monospace" font-size="3.2" font-weight="700" fill="{C["yellow"]}" text-anchor="start">{num}</text>')


def tower(x, y, ghost=False):
    """ATC tower: base building, tall shaft (3/4 view), octagonal glass cab, antenna. (x, y) = base centre."""
    if ghost:
        return (f'<rect x="{x - 13}" y="{y - 34}" width="26" height="40" fill="rgba(56,208,176,0.25)" stroke="#38d0b0" stroke-width="0.6" stroke-dasharray="1.5 1"></rect>')
    cab = ' '.join(f'{x + 9 * c:.1f},{y - 26 + 9 * s:.1f}' for c, s in [(-0.38, -0.92), (0.38, -0.92), (0.92, -0.38), (0.92, 0.38), (0.38, 0.92), (-0.38, 0.92), (-0.92, 0.38), (-0.92, -0.38)])
    cab2 = ' '.join(f'{x + 6.3 * c:.1f},{y - 26 + 6.3 * s:.1f}' for c, s in [(-0.38, -0.92), (0.38, -0.92), (0.92, -0.38), (0.92, 0.38), (0.38, 0.92), (-0.38, 0.92), (-0.92, 0.38), (-0.92, -0.38)])
    return (f'<path d="M{x + 3},{y} L{x + 34},{y + 14} L{x + 34},{y + 19} L{x - 3},{y + 4} Z" fill="{C["shadow"]}"></path>'
            + box(x - 12, y - 4, 24, 9, 4, '#2a3531', '#151c19') + hvac(x + 4, y - 2, 5, 3) +
            f'<rect x="{x - 3}" y="{y - 22}" width="6" height="21" fill="#2b3732"></rect><rect x="{x - 3}" y="{y - 22}" width="2.2" height="21" fill="#3a4943"></rect><rect x="{x + 1.6}" y="{y - 22}" width="1.4" height="21" fill="#1d2622"></rect>'
            f'<polygon points="{cab}" fill="{C["roofEdge"]}"></polygon><polygon points="{cab2}" fill="{C["glass"]}"></polygon>'
            f'<polygon points="{cab2}" fill="none" stroke="{C["glassHi"]}" stroke-width="0.4"></polygon>'
            f'<circle cx="{x}" cy="{y - 26}" r="3.2" fill="{C["roof"]}"></circle><rect x="{x - 0.4}" y="{y - 38}" width="0.8" height="10" fill="#8a9a95"></rect>'
            f'<circle cx="{x}" cy="{y - 38}" r="0.8" fill="#ff5a4a"></circle>')


def edge_lights():
    """Blue taxiway edge lights. Gaps where links/connectors open into Taxiway A (no lights across a T-junction mouth)."""
    h = TW / 2 + 0.6
    out = []
    dot = lambda x, y: out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="0.5" fill="{C["edgeBlue"]}"></circle>')
    top_gaps = [(x - h - 4, x + h + 4) for x in (78, 140, 250)]
    bot_gaps = [(x - h - 4, x + h + 4) for x in (180,)]
    for x in range(52, 309, 8):
        if not any(a <= x <= b for a, b in top_gaps):
            dot(x, 150 - h)
        if not any(a <= x <= b for a, b in bot_gaps):
            dot(x, 150 + h)
    # end corners: lights follow the outer curve, then run down both sides of the connectors
    import math
    for cx, ccx, a0 in ((40, 50, 180), (320, 310, 270)):
        for k in range(1, 4):
            a = math.radians(a0 + 90 * k / 4)
            dot(ccx + (10 + h) * math.cos(a), 160 + (10 + h) * math.sin(a))
        for y in range(166, 192, 6):
            dot(cx - h, y); dot(cx + h, y)
    # middle connector to the runway
    for y in range(166, 192, 6):
        dot(180 - h, y); dot(180 + h, y)
    # apron links: both sides, between apron edge and the taxiway mouth
    for x in (78, 140, 250):
        for y in (122, 128, 134):
            dot(x - h, y); dot(x + h, y)
    return ''.join(out)


def scene(mode='live', overlay=''):
    rnd = random.Random(5)
    o = [DEFS, f'<rect x="0" y="0" width="{WW}" height="{WH}" fill="{C["grass"]}"></rect>']
    for _ in range(150):
        o.append(f'<circle cx="{rnd.uniform(0, WW):.1f}" cy="{rnd.uniform(0, WH):.1f}" r="{rnd.uniform(3, 9):.1f}" fill="{rnd.choice([C["grass2"], C["grass3"]])}" opacity="0.6"></circle>')
    # outside the fence: road + trees only out here
    o.append(f'<rect x="0" y="4" width="{WW}" height="8" fill="#161c1f"></rect>' + line(f'M0,8 H{WW}', '#3a4248', 0.4, '3 3'))
    for (x, y, r) in [(4, 40, 4), (5, 80, 5), (4, 120, 4), (6, 170, 5), (4, 215, 4), (356, 50, 4), (355, 100, 5), (356, 150, 4), (355, 200, 5),
                      (40, 244, 4), (90, 245, 5), (150, 244, 4), (210, 245, 5), (270, 244, 4), (330, 245, 5)]:
        o.append(tree(x, y, r))
    o.append(f'<rect x="12" y="16" width="336" height="222" fill="none" stroke="{C["fence"]}" stroke-width="0.6" stroke-dasharray="2 1.5"></rect>')
    # aprons
    o.append(f'<rect x="51.5" y="61.5" width="267" height="55" fill="{C["asphaltEdge"]}"></rect><rect x="52" y="62" width="266" height="54" fill="{C["asphalt"]}"></rect>')
    for x in range(52, 319, 12):
        o.append(f'<rect x="{x}" y="62" width="0.25" height="54" fill="#20272b"></rect>')
    for y in range(68, 117, 12):
        o.append(f'<rect x="52" y="{y}" width="266" height="0.25" fill="#20272b"></rect>')
    # terminal
    o.append(terminal(64, 24, w=136))
    o.append(label(132, 21, 'TERMINAL'))
    # cargo hub
    o.append(cargo_hub(222, 28))
    for k, x in enumerate(range(304, 318, 4)):
        for j in range(4):
            o.append(f'<rect x="{x}" y="{36 + j * 5}" width="3.2" height="3.6" fill="{["#5b3a32", "#2f4a5e", "#3a5a4f", "#5e5530"][(k + j) % 4]}"></rect>')
    o.append(f'<rect x="306" y="58" width="10" height="4" rx="0.6" fill="#3d4a52"></rect><rect x="316" y="58.5" width="3" height="3" fill="#56636b"></rect>')
    o.append(label(262, 25, 'CARGO'))
    # tower (top-left)
    o.append(tower(32, 52, ghost=False) if mode != 'build-move' else tower(32, 52))
    o.append(label(32, 70, 'TWR'))
    # jet bridges
    for cx in (76, 102, 124, 156, 189):
        o.append(f'<rect x="{cx + 2.6}" y="61" width="2.4" height="14" fill="#33403a"></rect><rect x="{cx + 2.6}" y="61" width="0.8" height="14" fill="#435249"></rect>'
                 f'<rect x="{cx + 1.6}" y="74" width="4.4" height="2.4" fill="#33403a"></rect>')
    # holding bays (right)
    o.append(band('M318,108 L330,108 Q336,108 336,102 L336,70', 16))
    for y in (78, 97):
        o.append(f'<rect x="324" y="{y - 9}" width="24" height="18" fill="{C["asphalt"]}"></rect>'
                 f'<rect x="324.5" y="{y - 8.5}" width="23" height="17" fill="none" stroke="{C["yellow"]}" stroke-width="0.4" stroke-dasharray="1.4 1"></rect>')
    o.append(label(336, 70, 'BAYS'))
    # main taxiway A + links + runway connectors
    o.append(band('M40,196 L40,160 Q40,150 50,150 L310,150 Q320,150 320,160 L320,196'))
    for x in (78, 140, 250):
        o.append(band(f'M{x},116 L{x},150'))
    o.append(band('M180,150 L180,196'))
    # fire station between taxiway and runway, with an access lane onto the runway strip
    o.append(fire_station(94, 164))
    o.append(label(111, 164, 'FIRE &amp; RESCUE'))
    # runway (30 wide)
    o.append(f'<rect x="28" y="196" width="304" height="32" fill="{C["asphaltEdge"]}"></rect><rect x="28" y="197" width="304" height="30" fill="{C["asphalt"]}"></rect>')
    o.append(line('M28,197.5 H332', C['white'], 0.4, cap='butt') + line('M28,226.5 H332', C['white'], 0.4, cap='butt'))
    for x in range(62, 300, 13):
        o.append(f'<rect x="{x}" y="211.6" width="7.5" height="0.8" fill="{C["white"]}"></rect>')
    for k in range(10):
        y = 199.5 + k * 2.65 + (1.2 if k >= 5 else 0)
        o.append(f'<rect x="31" y="{y:.1f}" width="10" height="1.4" fill="{C["white"]}"></rect><rect x="319" y="{y:.1f}" width="10" height="1.4" fill="{C["white"]}"></rect>')
    o.append(f'<text x="48" y="212" font-family="JetBrains Mono, monospace" font-size="8" font-weight="700" fill="{C["white"]}" text-anchor="middle" transform="rotate(90 48 212)">09</text>')
    o.append(f'<text x="312" y="212" font-family="JetBrains Mono, monospace" font-size="8" font-weight="700" fill="{C["white"]}" text-anchor="middle" transform="rotate(-90 312 212)">27</text>')
    for x in (78, 270):
        o.append(f'<rect x="{x}" y="201.5" width="12" height="3" fill="{C["white"]}"></rect><rect x="{x}" y="219.5" width="12" height="3" fill="{C["white"]}"></rect>')
    for x in range(28, 333, 8):
        o.append(f'<circle cx="{x}" cy="196.8" r="0.5" fill="{C["edgeWhite"]}"></circle><circle cx="{x}" cy="227.2" r="0.5" fill="{C["edgeWhite"]}"></circle>')
    for y in range(199, 226, 3):
        o.append(f'<circle cx="28.5" cy="{y}" r="0.5" fill="{C["green"]}"></circle>')
    for x in range(14, 27, 3):
        o.append(f'<circle cx="{x}" cy="212" r="0.55" fill="{C["edgeWhite"]}"></circle>')
    # centre lines: stop at the hold lines (y 184), no lead-on onto the runway
    o.append(line('M50,150 L310,150'))
    o.append(line('M40,182 L40,160 Q40,150 50,150'))
    o.append(line('M320,182 L320,160 Q320,150 310,150'))
    o.append(tjunc(180, 150, 182))
    for x in (78, 140, 250):
        o.append(tjunc(x, 150, 129, down=False))
    o.append(line('M56,108 L326,108 Q336,108 336,98 L336,70'))
    for x in (78, 140, 250):
        o.append(tjunc(x, 108, 129))
    for x in (40, 180, 320):
        o.append(hold_line(x, 183))
    o.append(sign(52, 180, '09-27') + sign(192, 180, '09-27') + sign(293, 180, '09-27'))
    o.append(edge_lights())
    # stands
    for cx, sz, n in ((76, 'M', '1'), (102, 'M', '2'), (124, 'S', '3'), (156, 'L', '4'), (189, 'M', '5')):
        o.append(stand(cx, sz, n))
    o.append(stand(240, 'M', 'C1'))
    o.append(stand(282, 'L', 'C2'))
    if mode.startswith('build'):
        dim = 'rgba(5,8,7,0.62)'
        o.append(f'<path d="M0,0 H{WW} V{WH} H0 Z M12,16 V238 H348 V16 Z" fill="{dim}" fill-rule="evenodd"></path>')
        o.append('<path d="M12,16 H348 V238 H12 Z" fill="none" stroke="#38d0b0" stroke-width="0.6"></path>')
        for x in range(16, 348, TILE):
            o.append(f'<rect x="{x}" y="16" width="0.15" height="222" fill="rgba(56,208,176,0.12)"></rect>')
        for y in range(16, 238, TILE):
            o.append(f'<rect x="12" y="{y}" width="336" height="0.15" fill="rgba(56,208,176,0.12)"></rect>')
    else:
        o.append(plane(76, 84, 'narrow', 'N', C['tail1']))
        o.append(plane(102, 84, 'narrow', 'N', C['tail2']))
        o.append(plane(124, 82, 'prop', 'N', C['tail3']))
        o.append(plane(156, 86.5, 'wide', 'N', C['tail4']))
        o.append(plane(240, 84, 'narrow', 'N', C['tail1']))
        o.append(plane(282, 86.5, 'jumbo', 'N', C['tail2']))
        o.append(plane(336, 97, 'narrow', 'N', C['tail3']))
        o.append(plane(236, 150, 'wide', 'W', C['tail1']))
        o.append(plane(140, 130, 'narrow', 'N', C['tail2']))
        o.append(plane(320, 174, 'prop', 'S', C['tail4']))
        o.append(plane(140, 212, 'narrow', 'E', C['tail3'], alt=1.4))
        o.append(plane(10, 212, 'narrow', 'E', C['tail1'], alt=4))
    o.append(overlay)
    return ''.join(o)


def svg(w, h, mode='live', overlay='', label='Airfield, top-down'):
    return (f'<svg viewBox="0 0 {WW} {WH}" width="{w}" height="{h}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="{label}" '
            f'style="display: block">{scene(mode, overlay)}</svg>')
