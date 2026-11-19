#!/usr/bin/env python3
"""Generates the AAB UI-direction artboards (one file per call: design_gen.py <name>)."""
import sys, random, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'project')
W, H = 1440, 900

# ---------------------------------------------------------------- pixel scene
WORLD_W, WORLD_H = 224, 136

PAL = {
    'day': dict(grass1='#6fa94f', grass2='#649d46', grassDot='#7db75b', concrete='#bdb8aa', apron='#aba699', apronLine='#9d988b',
                runway='#4a4d52', runwayEdge='#3e4145', mark='#f2f2ee', taxi='#5a5d62', taxiLine='#f2c230', road='#7c7f86', roadLine='#e9e6dc',
                roof='#d9d4c7', roofDark='#c5bfb0', wall='#8a8f99', glass='#7fb6d9', glassDark='#5d93b8', cargoRoof='#c97a3e', cargoRoof2='#b56a32',
                tree='#3f7a37', treeHi='#5a9a47', treeDark='#2f5f2b', shadow='rgba(20,30,20,0.28)', plane='#f4f5f7', planeShade='#cfd3da',
                tail1='#2f6fd6', tail2='#d9532b', tail3='#2a9d8f', cockpit='#2b3440', engine='#7d838c', fireRoof='#c8372d', bay='#e3b23c',
                container=['#c8372d', '#2f6fd6', '#2a9d8f', '#e3b23c'], car=['#d9532b', '#2f6fd6', '#f4f5f7', '#3b3f45'], light='#ffe9a8'),
    'night': dict(grass1='#0f1914', grass2='#0d1611', grassDot='#13201a', concrete='#1f2824', apron='#1b2420', apronLine='#25312b',
                  runway='#22272c', runwayEdge='#1a1e22', mark='#6d7a80', taxi='#20262a', taxiLine='#a8892a', road='#1c2125', roadLine='#3a4248',
                  roof='#2a3430', roofDark='#222b27', wall='#1a211e', glass='#2f7f78', glassDark='#215d58', cargoRoof='#3a2f26', cargoRoof2='#30271f',
                  tree='#12241a', treeHi='#183022', treeDark='#0b170f', shadow='rgba(0,0,0,0.5)', plane='#e8f6f2', planeShade='#9fb8b2',
                  tail1='#38d0b0', tail2='#f2a33a', tail3='#38d0b0', cockpit='#0d1513', engine='#55635f', fireRoof='#7a2a24', bay='#a8892a',
                  container=['#4a2c28', '#243a52', '#21403b', '#4d4322'], car=['#3a3f44', '#2a3036', '#3a3f44', '#2a3036'], light='#5ff2d0'),
    'pastel': dict(grass1='#9fd38b', grass2='#93ca7f', grassDot='#b3e09f', concrete='#ece5d6', apron='#e2dacb', apronLine='#d4cbba',
                   runway='#6b6f7d', runwayEdge='#5d6170', mark='#fffdf6', taxi='#7d8190', taxiLine='#ffd166', road='#a9a6b4', roadLine='#fffdf6',
                   roof='#fffaf0', roofDark='#efe6d4', wall='#c9b8d9', glass='#9fd8f0', glassDark='#7cc0de', cargoRoof='#f28c74', cargoRoof2='#e6765d',
                   tree='#5fae6a', treeHi='#7fcb84', treeDark='#4a9456', shadow='rgba(60,50,90,0.22)', plane='#fffdf8', planeShade='#e4dccd',
                   tail1='#5b8def', tail2='#f28c74', tail3='#46b8a8', cockpit='#4b4f63', engine='#a3a7b6', fireRoof='#ef6f6c', bay='#ffd166',
                   container=['#ef6f6c', '#5b8def', '#46b8a8', '#ffd166'], car=['#ef6f6c', '#5b8def', '#fffdf8', '#7d8190'], light='#fff2b3'),
}


def rect(x, y, w, h, fill, extra=''):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}"{extra}></rect>'


def plane_mask(kind):
    """Top-down plane pointing north. Returns list of (x, y, role) with x,y relative to centre-top."""
    if kind == 'S':   # small prop / turboprop
        L, span, wr, tr, tspan = 9, 11, 3, 7, 5
    elif kind == 'M':
        L, span, wr, tr, tspan = 15, 15, 5, 12, 7
    else:             # L
        L, span, wr, tr, tspan = 21, 21, 7, 17, 9
    px = {}
    fw = 1 if kind == 'S' else (1 if kind == 'M' else 2)
    for y in range(L):
        half = 0 if y == 0 else fw
        for x in range(-half, half + 1):
            px[(x, y)] = 'body'
    wd = 2 if kind == 'S' else (3 if kind == 'M' else 4)
    for k in range(wd):
        hs = span // 2 - (0 if kind == 'S' else k)
        for x in range(-hs, hs + 1):
            px[(x, wr + k + (0 if kind == 'S' else (k if abs(x) > 2 else 0)) * 0)] = px.get((x, wr + k), 'wing')
            if (x, wr + k) not in px or px[(x, wr + k)] != 'body':
                px[(x, wr + k)] = 'wing'
    # sweep: shift outer wing pixels back for jets
    if kind != 'S':
        swept = {}
        for (x, y), r in px.items():
            if r == 'wing' and abs(x) > 2:
                swept[(x, y + (abs(x) - 2) // 2)] = 'wing'
            else:
                swept[(x, y)] = r
        px = swept
    for k in range(2):
        hs = tspan // 2 - k
        for x in range(-hs, hs + 1):
            if px.get((x, tr + k)) != 'body':
                px[(x, tr + k)] = 'wing'
    px[(0, 1)] = 'cockpit'
    if kind != 'S':
        px[(0, 2)] = 'cockpit'
        for side in (-1, 1):
            ex = side * (span // 4 + 1)
            px[(ex, wr + 2)] = 'engine'
            if kind == 'L':
                px[(side * (span // 4 + 4), wr + 4)] = 'engine'
    px[(0, L - 1)] = 'tail'
    px[(0, L - 2)] = 'tail'
    return [(x, y, r) for (x, y), r in px.items()]


def plane(cx, cy, kind, heading, p, tail, alt=0, ring=None):
    """Draws a plane centred at (cx, cy). heading: N/E/S/W. alt>0 draws a detached shadow (depth)."""
    mask = plane_mask(kind)
    L = {'S': 9, 'M': 15, 'L': 21}[kind]
    out = []

    def tr(x, y):
        y = y - L // 2
        if heading == 'N': return x, y
        if heading == 'S': return -x, -y
        if heading == 'E': return -y, x
        return y, -x  # W

    off = alt
    for x, y, r in mask:
        X, Y = tr(x, y)
        out.append(rect(cx + X + 1 + off, cy + Y + 1 + off, 1, 1, p['shadow']))
    for x, y, r in mask:
        X, Y = tr(x, y)
        col = {'body': p['plane'], 'wing': p['planeShade'], 'cockpit': p['cockpit'], 'engine': p['engine'], 'tail': tail}[r]
        out.append(rect(cx + X, cy + Y, 1, 1, col))
    if ring:
        rr = L // 2 + 4
        out.append(f'<rect x="{cx - rr}" y="{cy - rr}" width="{2 * rr}" height="{2 * rr}" fill="none" stroke="{ring}" stroke-width="0.6" stroke-dasharray="1.5 1"></rect>')
    return ''.join(out)


def tree(x, y, p, r=4):
    o = [f'<circle cx="{x + 2}" cy="{y + 2}" r="{r}" fill="{p["shadow"]}"></circle>',
         f'<circle cx="{x}" cy="{y}" r="{r}" fill="{p["tree"]}"></circle>',
         f'<circle cx="{x - 1}" cy="{y - 1}" r="{max(1, r - 2)}" fill="{p["treeHi"]}"></circle>']
    return ''.join(o)


def scene(style, overlay='', ringStyle=None, holdingRing=True):
    p = PAL[style]
    rnd = random.Random(7)
    o = []
    o.append(rect(0, 0, WORLD_W, WORLD_H, p['grass1']))
    for _ in range(420):
        o.append(rect(rnd.randrange(WORLD_W), rnd.randrange(WORLD_H), 1, 1, rnd.choice([p['grass2'], p['grassDot']])))
    # road + parking at top
    o.append(rect(0, 4, WORLD_W, 6, p['road']))
    for x in range(2, WORLD_W, 8):
        o.append(rect(x, 7, 4, 1, p['roadLine']))
    for i, x in enumerate(range(18, 40, 6)):
        o.append(rect(x, 5, 4, 2, p['car'][i % 4]))
    for i, x in enumerate(range(150, 176, 7)):
        o.append(rect(x, 8, 4, 2, p['car'][(i + 1) % 4]))
    # apron
    o.append(rect(24, 38, 156, 48, p['apron']))
    for x in range(24, 180, 20):
        o.append(rect(x, 38, 1, 48, p['apronLine']))
    # terminal (3/4 depth: roof + front wall with windows)
    o.append(rect(42, 18, 80, 3, p['shadow']))
    o.append(rect(40, 14, 80, 14, p['roof']))
    o.append(rect(40, 14, 80, 2, p['roofDark']))
    o.append(rect(40, 28, 80, 6, p['wall']))
    for x in range(42, 118, 4):
        o.append(rect(x, 29, 2, 3, p['glass']))
    o.append(rect(78, 16, 4, 10, p['roofDark']))
    # jet bridges + stands
    stands = [52, 72, 92, 112]
    for sx in stands:
        o.append(rect(sx - 1, 34, 2, 8, p['wall']))
        o.append(rect(sx, 44, 1, 30, p['taxiLine']))
        o.append(rect(sx - 6, 74, 13, 1, p['taxiLine']))
    # cargo hub
    o.append(rect(138, 20, 36, 3, p['shadow']))
    o.append(rect(136, 16, 36, 12, p['cargoRoof']))
    for x in range(136, 172, 4):
        o.append(rect(x, 16, 2, 12, p['cargoRoof2']))
    o.append(rect(136, 28, 36, 5, p['wall']))
    for i, x in enumerate(range(138, 170, 5)):
        o.append(rect(x, 34, 4, 2, p['container'][i % 4]))
    o.append(rect(154, 44, 1, 30, p['taxiLine']))
    # remote stands + holding bay
    o.append(rect(184, 46, 22, 30, p['concrete']))
    for y in (50, 62):
        o.append(rect(186, y, 18, 1, p['bay']))
        o.append(rect(186, y + 10, 18, 1, p['bay']))
        o.append(rect(186, y, 1, 10, p['bay']))
        o.append(rect(203, y, 1, 10, p['bay']))
    # ATC tower (shaft + cab, long shadow)
    o.append(f'<polygon points="196,40 214,46 214,49 199,43" fill="{p["shadow"]}"></polygon>')
    o.append(rect(194, 24, 4, 18, p['wall']))
    o.append(rect(190, 18, 12, 7, p['roof']))
    o.append(rect(190, 21, 12, 3, p['glass']))
    o.append(rect(191, 22, 10, 1, p['glassDark']))
    o.append(rect(195, 15, 2, 3, p['engine']))
    # fire station
    o.append(rect(206, 28, 14, 3, p['shadow']))
    o.append(rect(204, 24, 14, 8, p['fireRoof']))
    o.append(rect(204, 32, 14, 4, p['wall']))
    o.append(rect(206, 33, 4, 3, p['roofDark']))
    o.append(rect(212, 33, 4, 3, p['roofDark']))
    # taxiway parallel + connectors
    o.append(rect(20, 88, 188, 7, p['taxi']))
    o.append(rect(20, 91, 188, 1, p['taxiLine']))
    for cx in (28, 104, 196):
        o.append(rect(cx - 3, 86, 7, 18, p['taxi']))
        o.append(rect(cx, 86, 1, 18, p['taxiLine']))
    for cx in (60, 140):
        o.append(rect(cx - 3, 84, 7, 5, p['taxi']))
    # runway
    o.append(rect(12, 103, 200, 18, p['runwayEdge']))
    o.append(rect(12, 104, 200, 16, p['runway']))
    for x in range(30, 196, 10):
        o.append(rect(x, 111, 5, 1, p['mark']))
    for y in range(105, 120, 2):
        o.append(rect(14, y, 6, 1, p['mark']))
        o.append(rect(204, y, 6, 1, p['mark']))
    for x in range(12, 213, 6):
        o.append(rect(x, 103, 1, 1, p['light']))
        o.append(rect(x, 120, 1, 1, p['light']))
    # trees
    for (x, y, r) in [(6, 20, 4), (12, 28, 5), (4, 34, 3), (16, 18, 3), (214, 60, 4), (218, 72, 5), (210, 84, 3),
                      (8, 128, 4), (30, 130, 5), (60, 128, 3), (180, 130, 4), (200, 128, 5), (120, 131, 3), (150, 129, 4), (220, 128, 3)]:
        o.append(tree(x, y, p, r))
    # aircraft
    o.append(plane(52, 54, 'M', 'N', p, p['tail1']))
    o.append(plane(72, 54, 'M', 'N', p, p['tail2']))
    o.append(plane(112, 50, 'S', 'N', p, p['tail3']))
    o.append(plane(154, 56, 'L', 'N', p, p['tail2']))
    o.append(plane(195, 55, 'M', 'N', p, p['tail3']))
    o.append(plane(150, 91, 'M', 'W', p, p['tail1']))
    o.append(plane(84, 112, 'M', 'E', p, p['tail3'], alt=1))
    o.append(plane(2, 112, 'S', 'E', p, p['tail1'], alt=3))
    o.append(plane(170, 62 - 30, 'L', 'W', p, p['tail1'], alt=8, ring=ringStyle))
    o.append(plane(36, 66, 'M', 'S', p, p['tail2'], alt=0))
    if holdingRing:
        o.append(f'<circle cx="178" cy="130" r="0" fill="none"></circle>')
    o.append(overlay)
    return ''.join(o)


def svg(style, w, h, overlay='', ringStyle=None, label='Top-down pixel view of the airport'):
    return (f'<svg viewBox="0 0 {WORLD_W} {WORLD_H}" width="{w}" height="{h}" shape-rendering="crispEdges" preserveAspectRatio="xMidYMid slice" '
            f'role="img" aria-label="{label}" style="display: block">{scene(style, overlay, ringStyle)}</svg>')


# ---------------------------------------------------------------- icons (stroke)
def icon(name, size=20, color='currentColor', sw=1.8):
    paths = {
        'runway': '<path d="M4 20L10 4h4l6 16"></path><path d="M12 8v2M12 13v2M12 18v1"></path>',
        'stand': '<rect x="4" y="4" width="16" height="16" rx="1"></rect><path d="M12 4v8M8 12h8"></path>',
        'taxi': '<path d="M3 12h18"></path><path d="M3 7h18M3 17h18" stroke-dasharray="2 3"></path>',
        'tower': '<path d="M9 21h6M12 21V11"></path><path d="M7 7h10l-1 4H8z"></path><path d="M12 3v4"></path>',
        'building': '<path d="M3 21h18M5 21V8l7-4 7 4v13"></path><path d="M9 21v-5h6v5"></path>',
        'fire': '<path d="M12 3c3 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 2 3 3 3 0-3 0-5 0-7z"></path>',
        'bay': '<rect x="3" y="6" width="18" height="12" rx="1" stroke-dasharray="3 2"></rect>',
        'land': '<path d="M3 21h18"></path><path d="M4 16l14-4 2 3-14 3z"></path>',
        'pause': '<path d="M9 5v14M15 5v14"></path>',
        'play': '<path d="M7 5l12 7-12 7z"></path>',
        'ff': '<path d="M4 6l8 6-8 6zM12 6l8 6-8 6z"></path>',
        'divert': '<path d="M5 19L19 5"></path><path d="M10 5h9v9"></path>',
        'priority': '<path d="M12 19V5"></path><path d="M6 11l6-6 6 6"></path>',
        'rush': '<circle cx="12" cy="13" r="7"></circle><path d="M12 9v4l3 2M9 3h6"></path>',
        'stop': '<rect x="6" y="6" width="12" height="12" rx="1"></rect>',
        'calendar': '<rect x="3" y="5" width="18" height="16" rx="1"></rect><path d="M3 10h18M8 3v4M16 3v4"></path>',
        'coin': '<circle cx="12" cy="12" r="8"></circle><path d="M12 8v8M9.5 10h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"></path>',
        'alert': '<path d="M12 3l9 17H3z"></path><path d="M12 10v4M12 17v.5"></path>',
        'fuel': '<path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16"></path><path d="M5 11h10M15 8l3 3v7a1.5 1.5 0 0 0 3 0V9"></path>',
        'storm': '<path d="M7 16a4 4 0 1 1 1-7.9A5 5 0 0 1 18 9a3.5 3.5 0 0 1 0 7"></path><path d="M12 13l-2 4h3l-2 4"></path>',
        'plane': '<path d="M12 3v18M4 12l8-3 8 3M9 19l3-1 3 1"></path>',
        'gauge': '<path d="M4 16a8 8 0 1 1 16 0"></path><path d="M12 16l4-5"></path>',
        'grid': '<rect x="4" y="4" width="16" height="16"></rect><path d="M4 10h16M4 15h16M10 4v16M15 4v16"></path>',
        'demolish': '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"></path>',
        'close': '<path d="M6 6l12 12M18 6L6 18"></path>',
        'check': '<path d="M5 12l5 5 9-10"></path>',
        'map': '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"></path><path d="M9 4v14M15 6v14"></path>',
    }
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="{sw}" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{paths[name]}</svg>')


def page(title, fonts, body_css, root, props_extra=''):
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?{fonts}&amp;display=swap">
<style>
body{{margin:0}}
{body_css}
</style>
</helmet>
{root}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":{W},"height":{H}}}{props_extra}}}'>
class Component extends DCLogic {{
renderVals() {{
return {{}};
}}
}}
</script>
</body>
</html>
'''


# ================================================================ A · Classic Sim (Live)
def A_live():
    F = "family=Pixelify+Sans:wght@500;700&family=Inter:wght@400;500;600;700"
    css = "button{font:inherit;cursor:pointer}"
    font = "font-family: Inter, system-ui, sans-serif"
    pix = "font-family: 'Pixelify Sans', Inter, sans-serif"
    tools = [('runway', 'Runways'), ('taxi', 'Taxiways'), ('stand', 'Stands'), ('bay', 'Holding Bays'), ('building', 'Buildings'), ('tower', 'ATC Tower'), ('fire', 'Fire & Rescue'), ('demolish', 'Demolish')]
    toolbar = ''.join(
        f'<button type="button" aria-label="{n}" style="width: 52px; height: 52px; border-radius: 10px; border: 2px solid #2b2f36; background: #3a3f48; color: #f4f1e8; display: flex; align-items: center; justify-content: center; box-shadow: inset 0 -3px 0 #2b2f36">{icon(i, 24)}</button>'
        for i, n in tools)
    hold = [('B777-300ER', 'Large · Pax', 38, '#2f6fd6', 'Radar 2/6'), ('A320', 'Medium · Pax', 21, '#e3b23c', ''), ('Dash 8-Q400', 'Small · Pax', 9, '#c8372d', 'LOW FUEL')]
    holdHtml = ''.join(f'''
<div style="display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: #2f343c; border-radius: 8px">
<div style="width: 8px; height: 36px; border-radius: 3px; background: {c}"></div>
<div style="flex: 1; display: flex; flex-direction: column; gap: 2px">
<div style="font-weight: 600; font-size: 14px">{n}</div>
<div style="font-size: 12px; color: #c9c4b6">{s} · Fuel {f} min</div>
</div>
<div style="font-size: 11px; font-weight: 700; color: {'#ffb4a8' if t == 'LOW FUEL' else '#c9c4b6'}">{t}</div>
</div>''' for n, s, f, c, t in hold)
    acts = [('stop', 'Ground Stop', 'Ready'), ('priority', 'Priority Landing', 'Ready'), ('divert', 'Manual Divert', '14 min'), ('rush', 'Rush Turnaround', 'Ready')]
    actHtml = ''.join(f'''<button type="button" style="flex: 1; height: 64px; border-radius: 10px; border: 2px solid #2b2f36; background: {'#3a3f48' if r == 'Ready' else '#2c3037'}; color: {'#f4f1e8' if r == 'Ready' else '#9a958a'}; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; box-shadow: inset 0 -3px 0 #2b2f36">{icon(i, 20)}<span style="font-size: 12px; font-weight: 600">{n}</span><span style="font-size: 11px; color: #c9c4b6">{r}</span></button>'''
                      for i, n, r in acts)
    root = f'''<div style="width: {W}px; height: {H}px; position: relative; overflow: hidden; background: #6fa94f; {font}; color: #f4f1e8">
<div style="position: absolute; inset: 0">{svg('day', W, H)}</div>
<div style="position: absolute; top: 0; left: 0; right: 0; height: 64px; background: #2b2f36; display: flex; align-items: center; gap: 28px; padding: 0 20px; box-shadow: 0 3px 0 #1d2025">
<div style="{pix}; font-size: 26px; font-weight: 700; letter-spacing: 0.5px">14:37</div>
<div style="display: flex; flex-direction: column; gap: 2px"><div style="font-size: 12px; color: #c9c4b6">Week 2 · Saturday</div><div style="font-size: 14px; font-weight: 700; color: #ffd27a">Rush Day</div></div>
<div style="display: flex; align-items: center; gap: 8px">{icon('coin', 20, '#ffd27a')}<span style="font-size: 18px; font-weight: 700">184,250</span></div>
<div style="display: flex; flex-direction: column; gap: 5px; width: 320px">
<div style="display: flex; justify-content: space-between; font-size: 12px"><span>Daily Quota</span><span style="font-weight: 700">96 / 150 Movements</span></div>
<div style="height: 10px; background: #1d2025; border-radius: 3px; position: relative"><div style="position: absolute; left: 0; top: 0; bottom: 0; width: 64%; background: #6fd16f; border-radius: 3px"></div><div style="position: absolute; left: 82%; top: -3px; bottom: -3px; width: 2px; background: #f4f1e8"></div></div>
</div>
<div style="display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: #3a3f48; border-radius: 8px">{icon('gauge', 18, '#ffd27a')}<span style="font-size: 13px">Risk <b style="color: #ffd27a">Medium</b></span></div>
<div style="flex: 1"></div>
<div style="display: flex; gap: 6px">
<button type="button" aria-label="Pause" style="width: 44px; height: 44px; border-radius: 8px; border: 2px solid #1d2025; background: #3a3f48; color: #f4f1e8; display: flex; align-items: center; justify-content: center">{icon('pause', 20)}</button>
<button type="button" aria-label="Normal speed" style="width: 44px; height: 44px; border-radius: 8px; border: 2px solid #ffd27a; background: #4a4f58; color: #ffd27a; display: flex; align-items: center; justify-content: center">{icon('play', 20)}</button>
<button type="button" aria-label="Fast forward" style="width: 44px; height: 44px; border-radius: 8px; border: 2px solid #1d2025; background: #3a3f48; color: #f4f1e8; display: flex; align-items: center; justify-content: center">{icon('ff', 20)}</button>
</div>
</div>
<div style="position: absolute; top: 84px; left: 16px; display: flex; flex-direction: column; gap: 8px; padding: 8px; background: #2b2f36; border-radius: 12px; box-shadow: 0 3px 0 #1d2025">{toolbar}</div>
<div style="position: absolute; top: 84px; right: 16px; width: 300px; display: flex; flex-direction: column; gap: 12px">
<div style="background: #2b2f36; border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 3px 0 #1d2025">
<div style="display: flex; justify-content: space-between; align-items: center"><span style="{pix}; font-size: 18px">Holding</span><span style="font-size: 12px; color: #c9c4b6">3 aircraft</span></div>
{holdHtml}
</div>
<div style="background: #2b2f36; border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 3px 0 #1d2025">
<div style="{pix}; font-size: 18px">Selected · B747-8F</div>
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; font-size: 13px">
<div style="display: flex; flex-direction: column"><span style="color: #c9c4b6; font-size: 12px">Stand</span><b>Cargo Hub · L1</b></div>
<div style="display: flex; flex-direction: column"><span style="color: #c9c4b6; font-size: 12px">Turnaround</span><b>Ready 15:12</b></div>
<div style="display: flex; flex-direction: column"><span style="color: #c9c4b6; font-size: 12px">Arrival Fee</span><b>+1,800 paid</b></div>
<div style="display: flex; flex-direction: column"><span style="color: #c9c4b6; font-size: 12px">Departure Fee</span><b>+1,800</b></div>
</div>
</div>
</div>
<div style="position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); width: 640px; background: #2b2f36; border-radius: 12px; padding: 10px; display: flex; gap: 8px; box-shadow: 0 3px 0 #1d2025">{actHtml}</div>
<div style="position: absolute; left: 16px; bottom: 16px; width: 220px; height: 136px; background: #2b2f36; border-radius: 12px; padding: 6px; box-shadow: 0 3px 0 #1d2025"><div style="width: 208px; height: 124px; border-radius: 6px; overflow: hidden; position: relative">{svg('day', 208, 124, label='Minimap')}<div style="position: absolute; left: 60px; top: 30px; width: 90px; height: 60px; border: 2px solid #ffd27a"></div></div></div>
<div style="position: absolute; left: 610px; top: 520px; background: #2b2f36; border: 2px solid #ffb4a8; border-radius: 8px; padding: 6px 10px; font-size: 12px; display: flex; align-items: center; gap: 6px">{icon('fuel', 14, '#ffb4a8')}<span>Dash 8 low on fuel · jumps queue</span></div>
</div>'''
    return page('Classic Sim · Live Day', F, css, root)


def write(name, html):
    os.makedirs(ROOT, exist_ok=True)
    with open(os.path.join(ROOT, name), 'w') as f:
        f.write(html)
    print(name, len(html))


def grid_overlay(color='rgba(255,255,255,0.18)'):
    o = []
    for x in range(0, WORLD_W + 1, 8):
        o.append(f'<rect x="{x}" y="0" width="0.25" height="{WORLD_H}" fill="{color}"></rect>')
    for y in range(0, WORLD_H + 1, 8):
        o.append(f'<rect x="0" y="{y}" width="{WORLD_W}" height="0.25" fill="{color}"></rect>')
    return ''.join(o)


def A_plan():
    F = "family=Pixelify+Sans:wght@500;700&family=Inter:wght@400;500;600;700"
    css = "button{font:inherit;cursor:pointer}"
    font = "font-family: Inter, system-ui, sans-serif"
    pix = "font-family: 'Pixelify Sans', Inter, sans-serif"
    ghost = (grid_overlay() +
             '<rect x="160" y="40" width="16" height="24" fill="rgba(111,209,111,0.45)" stroke="#6fd16f" stroke-width="0.8"></rect>'
             '<rect x="168" y="40" width="1" height="24" fill="#f4f1e8"></rect>'
             '<rect x="128" y="64" width="16" height="16" fill="rgba(255,120,100,0.35)" stroke="#ff7864" stroke-width="0.8"></rect>')
    tabs = ['Runways', 'Stands', 'Holding Bays', 'Buildings', 'ATC Tower', 'Land']
    tabHtml = ''.join(f'<button type="button" style="height: 40px; padding: 0 16px; border-radius: 8px 8px 0 0; border: 0; background: {"#3a3f48" if t == "Stands" else "#2b2f36"}; color: {"#ffd27a" if t == "Stands" else "#c9c4b6"}; font-weight: 600; font-size: 14px">{t}</button>' for t in tabs)
    items = [('Small Contact Stand', '8,000', '+250', '1', 'Terminal'), ('Medium Contact Stand', '20,000', '+250', '1', 'Terminal · #4'),
             ('Large Contact Stand', '45,000', '+250', '1', 'Terminal · #2'), ('Medium Remote Stand', '4,000', '+120', '1', 'slower Turnaround'),
             ('Large Cargo Hub Stand', '36,000', '+250', '1', 'Cargo Hub'), ('Medium Cargo Hub Stand', '12,500', '+250', '1', 'Cargo Hub · #3')]
    itemHtml = ''.join(f'''<button type="button" style="width: 196px; min-height: 120px; border-radius: 10px; border: 2px solid {"#ffd27a" if i == 4 else "#2b2f36"}; background: #3a3f48; color: #f4f1e8; text-align: left; padding: 10px; display: flex; flex-direction: column; gap: 6px; box-shadow: inset 0 -3px 0 #2b2f36">
<span style="display: flex; align-items: center; gap: 8px">{icon('stand', 18, '#ffd27a')}<b style="font-size: 13px">{n}</b></span>
<span style="font-size: 12px; color: #c9c4b6">{sub}</span>
<span style="display: flex; justify-content: space-between; font-size: 12px; margin-top: auto"><span style="color: #ffd27a; font-weight: 700">{c}</span><span style="color: #c9c4b6">{u}/Day · {sp} space</span></span>
</button>''' for i, (n, c, u, sp, sub) in enumerate(items))
    days = [('Mon', '✓', '#6fd16f', '96/75'), ('Tue', '✓', '#6fd16f', '103/90'), ('Wed', '✓', '#6fd16f', '106/83'), ('Thu', '✓', '#6fd16f', '106/86'), ('Fri', '✓', '#6fd16f', '127/90'), ('Sat', 'next', '#ffd27a', 'Q150'), ('Sun', 'boss', '#ff9f8f', 'Q144')]
    dayHtml = ''.join(f'''<div style="flex: 1; border-radius: 8px; padding: 6px 4px; background: {"#4a4f58" if s == "next" else "#3a3f48"}; border: 2px solid {c if s != "✓" else "#2b2f36"}; display: flex; flex-direction: column; align-items: center; gap: 2px">
<span style="font-size: 11px; color: #c9c4b6">{d}</span>
{icon('check', 16, c) if s == '✓' else (icon('storm', 16, c) if s == 'boss' else icon('plane', 16, c))}
<span style="font-size: 11px; font-weight: 700">{q}</span></div>''' for d, s, c, q in days)
    root = f'''<div style="width: {W}px; height: {H}px; position: relative; overflow: hidden; background: #6fa94f; {font}; color: #f4f1e8">
<div style="position: absolute; inset: 0">{svg('day', W, H, overlay=ghost)}</div>
<div style="position: absolute; top: 0; left: 0; right: 0; height: 64px; background: #2b2f36; display: flex; align-items: center; gap: 24px; padding: 0 20px; box-shadow: 0 3px 0 #1d2025">
<div style="{pix}; font-size: 24px; font-weight: 700; color: #ffd27a">Plan Mode</div>
<div style="font-size: 14px; color: #c9c4b6">Before Week 2 · Saturday (Rush Day)</div>
<div style="display: flex; align-items: center; gap: 8px">{icon('coin', 20, '#ffd27a')}<span style="font-size: 18px; font-weight: 700">184,250</span></div>
<div style="font-size: 13px; color: #c9c4b6">Upkeep 8,000/Day · Space 41/48</div>
<div style="flex: 1"></div>
<button type="button" style="height: 44px; padding: 0 22px; border-radius: 10px; border: 0; background: #ffd27a; color: #2b2f36; font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 8px; box-shadow: inset 0 -3px 0 #c9a04f">{icon('play', 18, '#2b2f36')}Start Saturday</button>
</div>
<div style="position: absolute; top: 84px; right: 16px; width: 340px; display: flex; flex-direction: column; gap: 12px">
<div style="background: #2b2f36; border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 3px 0 #1d2025">
<div style="display: flex; align-items: center; gap: 8px">{icon('calendar', 18, '#ffd27a')}<span style="{pix}; font-size: 18px">Week 2</span></div>
<div style="display: flex; gap: 4px">{dayHtml}</div>
<div style="font-size: 12px; color: #ffb4a8; display: flex; align-items: center; gap: 6px">{icon('storm', 16, '#ffb4a8')}<span>Boss Day: Heavy Rain + Crosswind, Wind Shift 14:00</span></div>
</div>
<div style="background: #2b2f36; border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 3px 0 #1d2025">
<div style="{pix}; font-size: 18px">Forecast · Saturday</div>
<div style="font-size: 13px; display: flex; justify-content: space-between"><span>Daily Quota</span><b>150 Movements</b></div>
<div style="font-size: 13px; display: flex; justify-content: space-between"><span>Arrivals coming</span><b>42 S · 48 M · 6 L</b></div>
<div style="font-size: 13px; display: flex; justify-content: space-between"><span>Peaks</span><b>08–10 · 17–19</b></div>
<div style="font-size: 12px; color: #ffd27a; padding: 8px; background: #3a3f48; border-radius: 8px">2 Large flights won't come: not enough Large Stands.</div>
</div>
</div>
<div style="position: absolute; left: 40px; top: 360px; background: #2b2f36; border: 2px solid #6fd16f; border-radius: 8px; padding: 6px 10px; font-size: 12px">Place Large Cargo Hub Stand · 36,000 · drag to rotate</div>
<div style="position: absolute; left: 16px; right: 372px; bottom: 0; display: flex; flex-direction: column">
<div style="display: flex; gap: 4px; padding-left: 8px">{tabHtml}</div>
<div style="background: #3a3f48; border-radius: 12px 12px 0 0; padding: 14px; display: flex; gap: 10px; overflow: hidden; box-shadow: 0 -3px 0 #2b2f36">{itemHtml}</div>
</div>
</div>'''
    return page('Classic Sim · Plan Mode', F, css, root)


if __name__ == '__main__':
    which = sys.argv[1]
    sys.path.insert(0, os.path.dirname(__file__))
    import design_b2, design_b5
    globals().update({'B_plan': design_b2.B_plan, 'B_live': design_b5.B_live, 'B_build': design_b5.B_build})
    try:
        import design_c
        globals().update({k: getattr(design_c, k) for k in ('C_live', 'C_plan')})
    except ImportError:
        pass
    fn = {k: v for k, v in [('Main.dc.html', A_live), ('A-Plan.dc.html', A_plan), ('B-Live.dc.html', globals().get('B_live')), ('B-Plan.dc.html', globals().get('B_plan')), ('C-Live.dc.html', globals().get('C_live')), ('C-Plan.dc.html', globals().get('C_plan')), ('B-Build.dc.html', globals().get('B_build'))]}
    write(which, fn[which]())


