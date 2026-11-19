"""Zoomed-out, grid-true airport scene for direction B (v2). World units = px; 1 tile = 8 px."""
import random

WW, WH = 320, 184
T = 8
P = dict(grass1='#0f1914', grass2='#0d1611', grassDot='#13201a', apron='#1c2521', apronLine='#26332d', runway='#23282d', runwayEdge='#1a1e22',
         mark='#7c8a90', taxi='#1f262a', taxiLine='#b08f2c', road='#1c2125', roadLine='#3a4248', roof='#2b3631', roofDark='#222b27', wall='#18201c',
         glass='#2f7f78', cargoRoof='#3d3128', cargoRoof2='#33291f', tree='#12241a', treeHi='#183022', shadow='rgba(0,0,0,0.55)', plane='#e8f6f2',
         wing='#a9c2bb', cockpit='#0d1513', tail1='#38d0b0', tail2='#f2a33a', fireRoof='#7a2a24', stand='#38d0b0', standL='#f2a33a', bay='#b08f2c',
         light='#5ff2d0', locked='#0a0f0d', lockedLine='#16211c')

SPR = {
    'S': ['...#...', '...c...', '#######', '...#...', '...#...', '.#####.', '...t...'],
    'M': ['......#......', '.....#c#.....', '.....###.....', '....#####....', '..#########..', '#############', '##.e.###.e.##',
          '.....###.....', '.....###.....', '...#######...', '......t......'],
    'L': ['.......#.......', '......#c#......', '......###......', '......###......', '.....#####.....', '...#########...', '.#############.',
          '###############', '##.e..###..e.##', '......###......', '......###......', '......###......', '....#######....', '...####t####...', '.......t.......'],
}


def r(x, y, w, h, f):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{f}"></rect>'


def plane(cx, cy, kind, heading, tail, alt=0):
    rows = SPR[kind]
    hgt, wid = len(rows), len(rows[0])
    mid = wid // 2
    fus = 0 if kind == 'S' else 1
    px = []
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == '.':
                continue
            dx, dy = x - mid, y - hgt // 2
            role = {'c': 'cockpit', 'e': 'engine', 't': 'tail'}.get(ch, 'body' if abs(dx) <= fus else 'wing')
            if heading == 'S': dx, dy = -dx, -dy
            elif heading == 'E': dx, dy = -dy, dx
            elif heading == 'W': dx, dy = dy, -dx
            px.append((dx, dy, role))
    o = [r(cx + dx + 1 + alt, cy + dy + 1 + alt, 1, 1, P['shadow']) for dx, dy, _ in px]
    col = {'body': P['plane'], 'wing': P['wing'], 'cockpit': P['cockpit'], 'engine': '#55635f', 'tail': tail}
    o += [r(cx + dx, cy + dy, 1, 1, col[role]) for dx, dy, role in px]
    return ''.join(o)


def stand(x, y, size, col, occupied_label=''):
    s = 16 if size in ('S', 'M') else 24
    o = [f'<rect x="{x + 0.5}" y="{y + 0.5}" width="{s - 1}" height="{s - 1}" fill="none" stroke="{col}" stroke-width="0.6"></rect>',
         r(x + s // 2, y + 2, 0.6, s - 4, P['taxiLine'])]
    return ''.join(o)


def tree(x, y, rad=3):
    return (f'<circle cx="{x + 1.5}" cy="{y + 1.5}" r="{rad}" fill="{P["shadow"]}"></circle><circle cx="{x}" cy="{y}" r="{rad}" fill="{P["tree"]}"></circle>'
            f'<circle cx="{x - 1}" cy="{y - 1}" r="{max(1, rad - 2)}" fill="{P["treeHi"]}"></circle>')


def scene(mode='live', overlay=''):
    rnd = random.Random(11)
    o = [r(0, 0, WW, WH, P['grass1'])]
    for _ in range(700):
        o.append(r(rnd.randrange(WW), rnd.randrange(WH), 1, 1, rnd.choice([P['grass2'], P['grassDot']])))
    # road
    o.append(r(0, 4, WW, 6, P['road']))
    for x in range(2, WW, 10):
        o.append(r(x, 6.5, 5, 1, P['roadLine']))
    # ATC tower (top-left)
    o.append(f'<polygon points="18,40 30,46 30,48 20,42" fill="{P["shadow"]}"></polygon>')
    o.append(r(14, 26, 4, 15, P['wall']))
    o.append(r(10, 18, 12, 8, P['roof']))
    o.append(r(10, 21, 12, 3, P['glass']))
    # aprons
    o.append(r(16, 48, 160, 48, P['apron']))
    o.append(r(176, 48, 64, 48, P['apron']))
    for x in range(16, 240, 16):
        o.append(r(x, 48, 0.4, 48, P['apronLine']))
    # terminal
    o.append(r(50, 28, 72, 3, P['shadow']))
    o.append(r(48, 24, 72, 16, P['roof']))
    o.append(r(48, 24, 72, 2, P['roofDark']))
    o.append(r(48, 40, 72, 8, P['wall']))
    for x in range(50, 118, 4):
        o.append(r(x, 42, 2, 3, P['glass']))
    # jet bridges
    for x in (56, 80, 104, 132):
        o.append(r(x - 0.5, 46, 1.5, 10, '#2b3631'))
    # cargo hub
    o.append(r(186, 28, 48, 3, P['shadow']))
    o.append(r(184, 24, 48, 16, P['cargoRoof']))
    for x in range(184, 232, 4):
        o.append(r(x, 24, 2, 16, P['cargoRoof2']))
    o.append(r(184, 40, 48, 8, P['wall']))
    # stands
    for x in (48, 72, 96):
        o.append(stand(x, 56, 'M', P['stand']))
    o.append(stand(120, 56, 'L', P['standL']))
    o.append(stand(184, 56, 'M', P['stand']))
    o.append(stand(208, 56, 'L', P['standL']))
    # remote stand
    o.append(f'<rect x="152.5" y="72.5" width="15" height="15" fill="none" stroke="{P["stand"]}" stroke-width="0.6" stroke-dasharray="2 1"></rect>')
    # holding bays (left of terminal apron)
    for y in (56, 76):
        o.append(f'<rect x="20.5" y="{y + 0.5}" width="15" height="15" fill="none" stroke="{P["bay"]}" stroke-width="0.6" stroke-dasharray="1.5 1"></rect>')
    # fire station
    o.append(r(250, 58, 14, 3, P['shadow']))
    o.append(r(248, 52, 14, 10, P['fireRoof']))
    o.append(r(248, 62, 14, 6, P['wall']))
    # apron → taxiway links
    for x in (40, 88, 144, 200):
        o.append(r(x, 96, 16, 8, P['taxi']))
        o.append(r(x + 7.7, 96, 0.6, 8, P['taxiLine']))
    # parallel taxiway
    o.append(r(24, 104, 232, 16, P['taxi']))
    o.append(r(24, 111.7, 232, 0.6, P['taxiLine']))
    # runway connectors
    for x in (24, 128, 240):
        o.append(r(x, 120, 16, 16, P['taxi']))
        o.append(r(x + 7.7, 120, 0.6, 16, P['taxiLine']))
        o.append(r(x, 132, 16, 1, P['taxiLine']))
    # runway
    o.append(r(8, 135, 256, 26, P['runwayEdge']))
    o.append(r(8, 136, 256, 24, P['runway']))
    for x in range(28, 248, 12):
        o.append(r(x, 147.6, 6, 0.8, P['mark']))
    for y in range(138, 159, 3):
        o.append(r(10, y, 8, 1.2, P['mark']))
        o.append(r(254, y, 8, 1.2, P['mark']))
    for x in range(8, 265, 8):
        o.append(r(x, 135, 0.8, 0.8, P['light']))
        o.append(r(x, 160.2, 0.8, 0.8, P['light']))
    # trees
    for (x, y, rad) in [(6, 172, 3), (22, 176, 4), (60, 174, 3), (110, 177, 4), (170, 173, 3), (215, 176, 4), (250, 172, 3),
                        (276, 30, 4), (290, 44, 3), (300, 90, 4), (284, 120, 3), (306, 150, 4), (290, 168, 3), (300, 20, 3)]:
        o.append(tree(x, y, rad))
    if mode == 'build':
        # locked land beyond the plot
        o.append(f'<rect x="272" y="0" width="48" height="{WH}" fill="rgba(5,8,7,0.6)"></rect>')
        for k in range(-WH, 48, 6):
            o.append(f'<path d="M{272 + k} {WH} L{272 + k + WH} 0" stroke="{P["lockedLine"]}" stroke-width="0.8"></path>')
        o.append(f'<rect x="272" y="0" width="0.8" height="{WH}" fill="#38d0b0"></rect>')
        # grid
        for x in range(0, 272, T):
            o.append(f'<rect x="{x}" y="0" width="0.2" height="{WH}" fill="rgba(56,208,176,0.16)"></rect>')
        for y in range(0, WH, T):
            o.append(f'<rect x="0" y="{y}" width="272" height="0.2" fill="rgba(56,208,176,0.16)"></rect>')
    else:
        # aircraft (no overflights)
        o.append(plane(56, 64, 'M', 'N', P['tail1']))
        o.append(plane(80, 64, 'M', 'N', P['tail2']))
        o.append(plane(132, 68, 'L', 'N', P['tail2']))
        o.append(plane(192, 64, 'M', 'N', P['tail1']))
        o.append(plane(220, 68, 'L', 'N', P['tail1']))
        o.append(plane(28, 64, 'M', 'E', P['tail1']))
        o.append(plane(180, 112, 'M', 'W', P['tail2']))
        o.append(plane(100, 112, 'S', 'E', P['tail1']))
        o.append(plane(248, 127, 'S', 'S', P['tail2']))
        o.append(plane(96, 148, 'M', 'E', P['tail1'], alt=1))
        o.append(plane(-2, 148, 'M', 'E', P['tail2'], alt=3))
    o.append(overlay)
    return ''.join(o)


def svg(w, h, mode='live', overlay='', label='Airfield, top-down'):
    return (f'<svg viewBox="0 0 {WW} {WH}" width="{w}" height="{h}" shape-rendering="crispEdges" preserveAspectRatio="xMidYMid meet" role="img" aria-label="{label}" '
            f'style="display: block">{scene(mode, overlay)}</svg>')
