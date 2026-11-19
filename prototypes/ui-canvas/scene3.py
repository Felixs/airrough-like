"""Direction B v3: smooth, realistic top-down airfield (vector). World units ~ metres/4; 1 tile = 8 units."""
import random

WW, WH = 352, 240
TILE = 8
C = dict(grass='#0f1a15', grass2='#0c1511', grass3='#13211a', concrete='#222c28', joint='#2b3732', asphalt='#1a2024', asphaltEdge='#141a1d',
         yellow='#c9a227', white='#b9c5c7', red='#b3392f', wall='#161d1a', roof='#26302c', roofEdge='#303c37', glass='#2c6f69',
         cargo='#2e2722', cargo2='#38302a', plane='#e4eeeb', wing='#b3c4bf', engine='#6c7a76', shadow='rgba(0,0,0,0.45)',
         tail1='#38d0b0', tail2='#f2a33a', tail3='#7aa7ff', edgeBlue='#4aa3ff', edgeWhite='#e6f0f2', green='#5ff28a', tree='#10261a', treeHi='#163223',
         car='#3a4248', lockedHatch='#1c2622')

PLANE = ('M0,-20 C1.6,-19.2 2.4,-16.5 2.4,-12 L2.4,-4.5 L17.5,3.2 L17.5,6.2 L2.4,2.6 L2.4,12 L7.2,15.6 L7.2,17.6 L1.2,16.8 L0,19.5 '
         'L-1.2,16.8 L-7.2,17.6 L-7.2,15.6 L-2.4,12 L-2.4,2.6 L-17.5,6.2 L-17.5,3.2 L-2.4,-4.5 L-2.4,-12 C-2.4,-16.5 -1.6,-19.2 0,-20 Z')
PROP = ('M0,-20 C1.8,-19 2.6,-16 2.6,-12 L2.6,-7 L19,-6 L19,-2 L2.6,-1 L2.6,12 L8,15 L8,17.5 L1.2,16.8 L0,19.5 L-1.2,16.8 L-8,17.5 L-8,15 '
        'L-2.6,12 L-2.6,-1 L-19,-2 L-19,-6 L-2.6,-7 L-2.6,-12 C-2.6,-16 -1.8,-19 0,-20 Z')
LEN = {'S': 10, 'M': 15, 'L': 21}
ROT = {'N': 0, 'E': 90, 'S': 180, 'W': 270}


def plane(x, y, kind, heading, tail, alt=0.6):
    s = LEN[kind] / 40
    rot = ROT[heading] if isinstance(heading, str) else heading
    shape = PROP if kind == 'S' else PLANE
    eng = '' if kind == 'S' else ('<rect x="-9.5" y="-1.5" width="2.4" height="5" rx="1" fill="#6c7a76"></rect><rect x="7.1" y="-1.5" width="2.4" height="5" rx="1" fill="#6c7a76"></rect>')
    if kind == 'S':
        eng = '<rect x="-9" y="-9" width="2" height="5" rx="1" fill="#6c7a76"></rect><rect x="7" y="-9" width="2" height="5" rx="1" fill="#6c7a76"></rect>'
    return (f'<g transform="translate({x + alt},{y + alt}) rotate({rot}) scale({s})"><path d="{shape}" fill="{C["shadow"]}"></path></g>'
            f'<g transform="translate({x},{y}) rotate({rot}) scale({s})">'
            f'<path d="{shape}" fill="{C["wing"]}"></path>'
            f'<path d="M0,-20 C1.6,-19.2 2.4,-16.5 2.4,-12 L2.4,12 L1.2,16.8 L0,19.5 L-1.2,16.8 L-2.4,12 L-2.4,-12 C-2.4,-16.5 -1.6,-19.2 0,-20 Z" fill="{C["plane"]}"></path>'
            f'{eng}<path d="M-1.4,-16.5 L1.4,-16.5 L1.1,-15 L-1.1,-15 Z" fill="#0d1513"></path>'
            f'<rect x="-0.9" y="11" width="1.8" height="8" fill="{tail}"></rect></g>')


def line(d, color=None, w=0.6, dash=None, cap='round'):
    color = color or C['yellow']
    da = f' stroke-dasharray="{dash}"' if dash else ''
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="{cap}" stroke-linejoin="round"{da}></path>'


def band(d, w=14, color=None):
    color = color or C['asphalt']
    return (f'<path d="{d}" fill="none" stroke="{C["asphaltEdge"]}" stroke-width="{w + 1}" stroke-linecap="butt" stroke-linejoin="round"></path>'
            f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="butt" stroke-linejoin="round"></path>')


def tjunc(x, y_main, y_branch, r=7, both=True, through=True, down=True):
    """Curved lead-off lines from a horizontal main line at y_main into a vertical branch at x."""
    sgn = 1 if down else -1
    out = []
    out.append(line(f'M{x - r},{y_main} Q{x},{y_main} {x},{y_main + sgn * r}'))
    if both:
        out.append(line(f'M{x + r},{y_main} Q{x},{y_main} {x},{y_main + sgn * r}'))
    out.append(line(f'M{x},{y_main + sgn * r} L{x},{y_branch}'))
    return ''.join(out)


def hold_line(x, y, w=14):
    """Runway holding position marking (2 solid + 2 dashed) across a vertical taxiway; dashed side faces the runway (below)."""
    x0, x1 = x - w / 2 + 0.6, x + w / 2 - 0.6
    return (line(f'M{x0},{y} H{x1}', w=0.5, cap='butt') + line(f'M{x0},{y + 1.2} H{x1}', w=0.5, cap='butt')
            + line(f'M{x0},{y + 2.6} H{x1}', w=0.5, dash='1.2 0.8', cap='butt') + line(f'M{x0},{y + 3.8} H{x1}', w=0.5, dash='1.2 0.8', cap='butt'))


def sign(x, y, text):
    return (f'<rect x="{x}" y="{y}" width="14" height="5" rx="0.6" fill="{C["red"]}"></rect>'
            f'<text x="{x + 7}" y="{y + 3.8}" font-family="JetBrains Mono, monospace" font-size="3.6" font-weight="700" fill="#ffffff" text-anchor="middle">{text}</text>')


def tree(x, y, r=4):
    return (f'<circle cx="{x + 1.2}" cy="{y + 1.2}" r="{r}" fill="{C["shadow"]}"></circle><circle cx="{x}" cy="{y}" r="{r}" fill="{C["tree"]}"></circle>'
            f'<circle cx="{x - r * 0.3}" cy="{y - r * 0.3}" r="{r * 0.55}" fill="{C["treeHi"]}"></circle>')


def stand(cx, size, num, y_top=72, y_lane=112):
    """Nose-in stand: lead-in line curving off the apron taxilane, stop bar, stand number, envelope."""
    w = 22 if size == 'M' else (30 if size == 'L' else 16)
    o = [f'<rect x="{cx - w / 2}" y="{y_top + 2}" width="{w}" height="{y_lane - y_top - 12}" fill="none" stroke="{C["red"]}" stroke-width="0.35" stroke-dasharray="1.2 1" opacity="0.8"></rect>',
         line(f'M{cx - 8},{y_lane} Q{cx},{y_lane} {cx},{y_lane - 8} L{cx},{y_top + 5}'),
         line(f'M{cx + 8},{y_lane} Q{cx},{y_lane} {cx},{y_lane - 8}'),
         line(f'M{cx - 3},{y_top + 5} H{cx + 3}', w=0.8, cap='butt'),
         f'<text x="{cx}" y="{y_lane - 11}" font-family="JetBrains Mono, monospace" font-size="4" font-weight="700" fill="{C["yellow"]}" text-anchor="middle">{num}</text>']
    return ''.join(o)


def scene(mode='live', overlay=''):
    rnd = random.Random(5)
    o = [f'<rect x="0" y="0" width="{WW}" height="{WH}" fill="{C["grass"]}"></rect>']
    for _ in range(140):
        o.append(f'<circle cx="{rnd.uniform(0, WW):.1f}" cy="{rnd.uniform(0, WH):.1f}" r="{rnd.uniform(3, 9):.1f}" fill="{rnd.choice([C["grass2"], C["grass3"]])}" opacity="0.6"></circle>')
    # road + car park
    o.append(f'<rect x="0" y="8" width="{WW}" height="8" fill="#161c1f"></rect>')
    o.append(line(f'M0,12 H{WW}', '#3a4248', 0.4, '3 3'))
    o.append(f'<rect x="56" y="20" width="112" height="14" fill="#1a2023"></rect>')
    for i, x in enumerate(range(58, 166, 5)):
        if i % 3 != 1:
            o.append(f'<rect x="{x}" y="{21 if i % 2 else 28}" width="3" height="4.6" rx="0.8" fill="{C["car"]}"></rect>')
    # ATC tower
    o.append(f'<path d="M24,58 L44,66 L44,69 L26,62 Z" fill="{C["shadow"]}"></path>')
    o.append(f'<rect x="21" y="44" width="5" height="16" fill="{C["wall"]}"></rect>')
    o.append(f'<circle cx="23.5" cy="42" r="7" fill="{C["roof"]}"></circle><circle cx="23.5" cy="42" r="5.2" fill="{C["glass"]}"></circle><circle cx="23.5" cy="42" r="2.4" fill="{C["roofEdge"]}"></circle>')
    # aprons with joints
    o.append(f'<rect x="40" y="68" width="250" height="56" fill="{C["concrete"]}"></rect>')
    for x in range(40, 291, 10):
        o.append(f'<rect x="{x}" y="68" width="0.3" height="56" fill="{C["joint"]}"></rect>')
    for y in range(68, 125, 10):
        o.append(f'<rect x="40" y="{y}" width="250" height="0.3" fill="{C["joint"]}"></rect>')
    # terminal + piers
    o.append(f'<rect x="58" y="42" width="112" height="22" fill="{C["shadow"]}"></rect>')
    o.append(f'<rect x="56" y="38" width="112" height="24" rx="1" fill="{C["roof"]}" stroke="{C["roofEdge"]}" stroke-width="0.6"></rect>')
    o.append(f'<rect x="56" y="62" width="112" height="6" fill="{C["wall"]}"></rect>')
    for x in range(58, 166, 3):
        o.append(f'<rect x="{x}" y="63.5" width="1.6" height="2.4" fill="{C["glass"]}"></rect>')
    for x in (60, 100, 140):
        o.append(f'<rect x="{x}" y="42" width="24" height="3" fill="{C["roofEdge"]}"></rect>')
    # cargo hub
    o.append(f'<rect x="216" y="42" width="72" height="22" fill="{C["shadow"]}"></rect>')
    o.append(f'<rect x="214" y="38" width="72" height="24" fill="{C["cargo"]}"></rect>')
    for x in range(214, 286, 6):
        o.append(f'<rect x="{x}" y="38" width="3" height="24" fill="{C["cargo2"]}"></rect>')
    o.append(f'<rect x="214" y="62" width="72" height="6" fill="{C["wall"]}"></rect>')
    # jet bridges
    for cx in (72, 96, 120, 144):
        o.append(f'<rect x="{cx + 3}" y="66" width="2" height="9" fill="#2e3934"></rect>')
    o.append('<rect x="179" y="66" width="2" height="10" fill="#2e3934"></rect>')
    # fire station
    o.append(f'<rect x="300" y="42" width="30" height="16" fill="{C["shadow"]}"></rect>')
    o.append(f'<rect x="298" y="38" width="30" height="16" fill="#5a231f"></rect><rect x="298" y="54" width="30" height="4" fill="{C["wall"]}"></rect>')
    # ---- taxiways (asphalt bands)
    o.append(band('M40,176 L40,152 Q40,144 48,144 L304,144 Q312,144 312,152 L312,176'))   # main A with end corners
    for x in (64, 128, 192, 256):
        o.append(band(f'M{x},124 L{x},144'))
    o.append(band('M176,144 L176,176'))
    o.append(band('M290,112 L320,112 Q328,112 328,104 L328,80', 12))  # stub to holding bays
    # holding bays
    for y in (80, 100):
        o.append(f'<rect x="318" y="{y - 9}" width="22" height="18" fill="{C["concrete"]}"></rect>')
        o.append(f'<rect x="318.5" y="{y - 8.5}" width="21" height="17" fill="none" stroke="{C["yellow"]}" stroke-width="0.4" stroke-dasharray="1.4 1"></rect>')
    # ---- runway
    o.append(f'<rect x="20" y="176" width="312" height="26" fill="{C["asphaltEdge"]}"></rect>')
    o.append(f'<rect x="20" y="177" width="312" height="24" fill="{C["asphalt"]}"></rect>')
    o.append(line('M20,177.4 H332', C['white'], 0.35, cap='butt') + line('M20,200.6 H332', C['white'], 0.35, cap='butt'))
    for x in range(52, 300, 12):
        o.append(f'<rect x="{x}" y="188.6" width="7" height="0.8" fill="{C["white"]}"></rect>')
    for k in range(8):
        y = 179 + k * 2.7 + (1.2 if k >= 4 else 0)
        o.append(f'<rect x="23" y="{y:.1f}" width="9" height="1.4" fill="{C["white"]}"></rect><rect x="320" y="{y:.1f}" width="9" height="1.4" fill="{C["white"]}"></rect>')
    o.append(f'<text x="40" y="189" font-family="JetBrains Mono, monospace" font-size="7" font-weight="700" fill="{C["white"]}" text-anchor="middle" transform="rotate(90 40 189)">09</text>')
    o.append(f'<text x="312" y="189" font-family="JetBrains Mono, monospace" font-size="7" font-weight="700" fill="{C["white"]}" text-anchor="middle" transform="rotate(-90 312 189)">27</text>')
    for x in (66, 286):
        o.append(f'<rect x="{x}" y="181" width="10" height="2.4" fill="{C["white"]}"></rect><rect x="{x}" y="194.6" width="10" height="2.4" fill="{C["white"]}"></rect>')
    for x in range(20, 333, 8):
        o.append(f'<circle cx="{x}" cy="177" r="0.5" fill="{C["edgeWhite"]}"></circle><circle cx="{x}" cy="201" r="0.5" fill="{C["edgeWhite"]}"></circle>')
    for y in range(179, 200, 3):
        o.append(f'<circle cx="20.5" cy="{y}" r="0.5" fill="{C["green"]}"></circle>')
    for x in range(2, 18, 3):
        o.append(f'<circle cx="{x}" cy="189" r="0.55" fill="{C["edgeWhite"]}"></circle>')
    # ---- taxi centre lines (connected, curved)
    o.append(line('M48,144 L304,144'))
    o.append(line('M40,186 L40,152 Q40,144 48,144'))                      # west end corner → runway
    o.append(line('M40,186 Q40,189 44,189 L52,189'))                       # lead-on 09
    o.append(line('M312,186 L312,152 Q312,144 304,144'))
    o.append(line('M312,186 Q312,189 308,189 L300,189'))                  # lead-on 27
    o.append(tjunc(176, 144, 182))
    o.append(line('M176,182 Q176,189 183,189') + line('M176,182 Q176,189 169,189'))
    for x in (64, 128, 192, 256):
        o.append(tjunc(x, 144, 124, down=False))
    # apron taxilane with T junctions into the links
    o.append(line('M44,112 L320,112 Q328,112 328,104 L328,74'))
    for x in (64, 128, 192, 256):
        o.append(tjunc(x, 112, 124))
    # hold lines + signs
    for x in (40, 176, 312):
        o.append(hold_line(x, 168))
    o.append(sign(48, 165, '09-27') + sign(184, 165, '09-27') + sign(290, 165, '27-09'))
    # taxiway edge lights (blue)
    for x in range(52, 304, 10):
        o.append(f'<circle cx="{x}" cy="136.6" r="0.45" fill="{C["edgeBlue"]}"></circle><circle cx="{x}" cy="151.4" r="0.45" fill="{C["edgeBlue"]}"></circle>')
    # stands
    for cx, n in ((72, '1'), (96, '2'), (120, '3'), (144, '4')):
        o.append(stand(cx, 'M', n))
    o.append(stand(180, 'L', '5'))
    o.append(stand(232, 'M', 'C1'))
    o.append(stand(266, 'L', 'C2'))
    # trees
    for (x, y, r) in [(8, 216, 5), (26, 226, 6), (60, 220, 4), (98, 230, 6), (140, 218, 5), (182, 228, 6), (226, 220, 4), (262, 231, 6), (300, 219, 5), (338, 228, 6),
                      (8, 60, 5), (8, 100, 6), (16, 132, 4), (340, 140, 5), (344, 160, 4)]:
        o.append(tree(x, y, r))
    if mode == 'build':
        o.append('<path d="M232,0 H352 V34 H232 Z" fill="rgba(5,8,7,0.7)"></path>')
        for k in range(-40, 130, 5):
            o.append(f'<path d="M{232 + k},34 L{232 + k + 34},0" stroke="{C["lockedHatch"]}" stroke-width="0.7"></path>')
        o.append('<path d="M232,34 H352 M232,0 V34" stroke="#38d0b0" stroke-width="0.5" fill="none"></path>')
        for x in range(0, WW + 1, TILE):
            o.append(f'<rect x="{x}" y="0" width="0.15" height="{WH}" fill="rgba(56,208,176,0.13)"></rect>')
        for y in range(0, WH + 1, TILE):
            o.append(f'<rect x="0" y="{y}" width="{WW}" height="0.15" fill="rgba(56,208,176,0.13)"></rect>')
    else:
        o.append(plane(72, 86, 'M', 'N', C['tail1']))
        o.append(plane(96, 86, 'M', 'N', C['tail2']))
        o.append(plane(144, 88, 'S', 'N', C['tail3']))
        o.append(plane(180, 88, 'L', 'N', C['tail2']))
        o.append(plane(232, 86, 'M', 'N', C['tail1']))
        o.append(plane(266, 88, 'L', 'N', C['tail3']))
        o.append(plane(328, 100, 'M', 'N', C['tail2']))
        o.append(plane(226, 144, 'M', 'W', C['tail1']))
        o.append(plane(128, 133, 'S', 'N', C['tail3']))
        o.append(plane(312, 160, 'S', 'S', C['tail2']))
        o.append(plane(132, 189, 'M', 'E', C['tail1'], alt=1.4))
        o.append(plane(6, 189, 'M', 'E', C['tail3'], alt=4))
    o.append(overlay)
    return ''.join(o)


def svg(w, h, mode='live', overlay='', label='Airfield, top-down'):
    return (f'<svg viewBox="0 0 {WW} {WH}" width="{w}" height="{h}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="{label}" '
            f'style="display: block">{scene(mode, overlay)}</svg>')
