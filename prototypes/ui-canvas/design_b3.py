"""Direction B v3: big map, collapsible left rail, smooth realistic airfield."""
from design_gen import icon, page, W, H
from design_b import B_BG, B_PANEL, B_LINE, B_TEXT, B_MUTE, B_TEAL, B_AMBER, B_RED, B_F, B_FONT, B_MONO, CSS, b_panel, btn, topbar
from design_b2 import tip, tabs
import scene3

WW, WH = scene3.WW, scene3.WH


def pin(x, y):
    return f'left: {x / WW * 100:.2f}%; top: {y / WH * 100:.2f}%'


def chip(text, col=B_TEXT, extra=''):
    return (f'<div style="position: absolute; {extra}; {B_MONO}; font-size: 11px; color: {col}; background: rgba(11,18,16,0.88); border: 1px solid {B_LINE}; '
            f'padding: 5px 8px; border-radius: 4px">{text}</div>')


def rail():
    items = [('Inbound', 'land', '2', B_MUTE), ('Holding', 'fuel', '3', B_RED), ('Ground', 'plane', '3', B_TEAL)]
    btns = ''.join(
        f'<button type="button" aria-label="{n}: {c}" style="position: relative; width: 40px; height: 52px; border: 1px solid {B_LINE}; border-radius: 4px; background: transparent; color: {B_TEXT}; '
        f'display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px">{icon(i, 18, col)}<span style="{B_MONO}; font-size: 11px">{c}</span></button>'
        for n, i, c, col in items)
    return (f'<div style="width: 48px; background: {B_PANEL}; border: 1px solid {B_LINE}; border-radius: 6px; padding: 4px; display: flex; flex-direction: column; gap: 6px; align-items: center">'
            f'<button type="button" aria-label="Expand flight strips" style="width: 40px; height: 32px; border: 1px solid {B_LINE}; border-radius: 4px; background: transparent; color: {B_TEAL}; {B_MONO}; font-size: 14px">»</button>'
            f'{btns}</div>')


def B_live():
    mapW = 1052
    mapH = round(mapW * WH / WW)
    labels = (chip(f'<span style="color: {B_TEAL}">RWY 09 ACTIVE</span> · SEP LDG 3:15 / TKO 2:26', extra='left: 10px; top: 10px')
              + chip('WIND 090/12 · SUN: WIND SHIFT 15:00', B_AMBER, 'right: 10px; top: 10px')
              + f'<div style="position: absolute; {pin(132, 196)}; transform: translate(-50%, 0); {B_MONO}; font-size: 10px; color: {B_TEAL}">DLH 2A · LANDING</div>'
              + f'<div style="position: absolute; {pin(318, 154)}; transform: translate(-100%, 0); {B_MONO}; font-size: 10px; color: {B_AMBER}">KLM 66 · HOLD SHORT</div>'
              + tip('STAND 3 · Medium · Terminal<br>free · next: AFR 12 (taxiing, 2 min)', f'{pin(120, 70)}; transform: translate(-50%, -110%)'))
    acts = [('G', 'Ground Stop', 'ready'), ('P', 'Priority Landing', 'ready'), ('D', 'Manual Divert', '14m'), ('R', 'Rush Turnaround', 'ready')]
    actHtml = ''.join(
        f'<button type="button" style="display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 10px; background: transparent; border: 1px solid {B_LINE}; border-radius: 4px; color: {B_TEXT if s == "ready" else B_MUTE}; {B_MONO}; font-size: 12px">'
        f'<span style="width: 22px; height: 22px; border: 1px solid {B_TEAL if s == "ready" else B_LINE}; border-radius: 3px; display: flex; align-items: center; justify-content: center; color: {B_TEAL if s == "ready" else B_MUTE}">{k}</span>'
        f'<span style="flex: 1; text-align: left">{n}</span><span style="color: {B_MUTE}">{s}</span></button>' for k, n, s in acts)
    stands = [('1', 1), ('2', 1), ('3', 0), ('4', 1), ('5', 1), ('C1', 1), ('C2', 1), ('B1', 0), ('B2', 1)]
    stHtml = ''.join(f'<span style="{B_MONO}; font-size: 11px; padding: 4px 7px; border-radius: 3px; border: 1px solid {B_TEAL if o else B_LINE}; color: {B_TEXT if o else B_MUTE}; background: {"#12302a" if o else "transparent"}">{n}</span>' for n, o in stands)
    right = (b_panel('Emergency Actions', f'<div style="padding: 8px; display: flex; flex-direction: column; gap: 6px">{actHtml}</div>')
             + b_panel('Alerts', f'<div style="padding: 10px 12px; {B_MONO}; font-size: 12px; display: flex; flex-direction: column; gap: 6px"><span style="color: {B_RED}">14:36 LOG 9Q low fuel · 9 min</span><span style="color: {B_AMBER}">14:31 Go-Around EZY 81</span><span style="color: {B_MUTE}">14:22 Taxiway Incident · cleared</span></div>')
             + b_panel('Stands · Bays 7/9 busy', f'<div style="padding: 10px; display: flex; flex-wrap: wrap; gap: 6px">{stHtml}</div>'))
    hours = list(range(5, 24))
    vals = [0, 4, 9, 12, 10, 7, 6, 6, 7, 8, 3, 0, 0, 0, 0, 0, 0, 0, 0]
    proj = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 7, 9, 11, 10, 7, 5, 3, 1]
    bars = ''.join(
        f'<div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px"><div style="height: 50px; width: 100%; display: flex; align-items: flex-end; justify-content: center">'
        f'<div style="width: 70%; height: {max(v, q) * 4}px; background: {B_TEAL if v else "transparent"}; border: 1px {"solid" if v else "dashed"} {B_TEAL if v else B_MUTE}; border-radius: 2px 2px 0 0"></div></div>'
        f'<span style="{B_MONO}; font-size: 10px; color: {B_MUTE}">{h:02d}</span></div>' for h, v, q in zip(hours, vals, proj))
    quota = (f'<div style="display: flex; flex-direction: column; gap: 4px; width: 280px"><div style="display: flex; justify-content: space-between; {B_MONO}; font-size: 12px"><span style="color: {B_MUTE}">QUOTA</span><b>96 / 150</b></div>'
             f'<div style="height: 8px; background: {B_LINE}; border-radius: 2px; position: relative"><div style="position: absolute; left: 0; top: 0; bottom: 0; width: 64%; background: {B_TEAL}; border-radius: 2px"></div>'
             f'<div style="position: absolute; left: 69%; top: -3px; bottom: -3px; width: 2px; background: {B_AMBER}"></div></div></div>')
    top = (f'<div style="{B_MONO}; font-size: 22px; font-weight: 700; color: {B_TEAL}">14:37</div>'
           f'<div style="{B_MONO}; font-size: 12px; color: {B_MUTE}">WK2 · SAT · RUSH DAY</div>' + quota
           + f'<div style="{B_MONO}; font-size: 13px; display: flex; align-items: center; gap: 6px">{icon("coin", 16, B_MUTE)}<b>184,250</b></div>'
           + '<div style="flex: 1"></div>'
           + f'<div style="display: flex; gap: 4px">{btn(icon("pause", 18), aria="Pause")}{btn("1×", True)}{btn("2×")}{btn("4×")}</div>')
    root = (f'<div style="width: {W}px; height: {H}px; background: {B_BG}; color: {B_TEXT}; {B_FONT}; display: flex; flex-direction: column; overflow: hidden">'
            + topbar(top)
            + f'<div style="flex: 1; display: flex; gap: 10px; padding: 10px; min-height: 0">'
            + rail()
            + f'<div style="position: relative; width: {mapW}px; height: {mapH}px; border: 1px solid {B_LINE}; border-radius: 6px; overflow: hidden; flex: none">{scene3.svg(mapW, mapH)}{labels}</div>'
            + f'<div style="flex: 1; display: flex; flex-direction: column; gap: 10px; min-width: 0">{right}</div></div>'
            + f'<div style="height: 96px; border-top: 1px solid {B_LINE}; padding: 8px 16px; display: flex; gap: 16px; align-items: stretch">'
            + f'<div style="width: 170px; display: flex; flex-direction: column; justify-content: center; gap: 4px; {B_MONO}; font-size: 12px"><span style="color: {B_MUTE}">MOVEMENTS / HOUR</span><span><span style="color: {B_TEAL}">■</span> done · <span style="color: {B_MUTE}">□</span> forecast</span></div>'
            + f'<div style="flex: 1; display: flex; gap: 4px; align-items: flex-end">{bars}</div></div></div>')
    return page('ATC Console · Live Day (v3)', B_F, CSS, root)


def B_build():
    groups = [
        ('RUNWAYS', [('runway', 'Short Runway', '30,000', False), ('runway', 'Medium Runway', '100,000', False), ('runway', 'Long Runway', '200,000', False)]),
        ('GROUND', [('taxi', 'Taxiway', '600 / tile', True), ('bay', 'Holding Bay', '8,000', False)]),
        ('STANDS', [('stand', 'Small Stand', '8,000', False), ('stand', 'Medium Stand', '20,000', False), ('stand', 'Large Stand', '56,300', False), ('stand', 'Remote Stand', '½ price', False)]),
        ('BUILDINGS', [('building', 'Terminal wing', '40,000', False), ('building', 'Cargo Hub wing', '35,000', False), ('fire', 'Fire & Rescue', 'built', False), ('building', 'Support', '24,000', False)]),
        ('LAND', [('map', 'Buy Land Plot', '48,000', False), ('demolish', 'Demolish', '50% refund', False)]),
    ]
    pal = ''
    for g, items in groups:
        pal += f'<div style="{B_MONO}; font-size: 10px; letter-spacing: 1.5px; color: {B_MUTE}; padding: 8px 4px 4px">{g}</div>'
        for ic, n, c, on in items:
            pal += (f'<button type="button" style="width: 100%; height: 36px; display: flex; align-items: center; gap: 10px; padding: 0 8px; border-radius: 4px; border: 1px solid {B_TEAL if on else "transparent"}; '
                    f'background: {"#12302a" if on else "transparent"}; color: {B_TEXT}; {B_MONO}; font-size: 12px">{icon(ic, 16, B_TEAL if on else B_MUTE)}<span style="flex: 1; text-align: left">{n}</span><span style="color: {B_MUTE}; font-size: 11px">{c}</span></button>')
    Y = scene3.C['yellow']
    # ghost: new taxiway link from apron taxilane down to the main taxiway at x=224, with connected curves
    overlay = (f'<path d="M224,124 L224,144" fill="none" stroke="rgba(56,208,176,0.45)" stroke-width="14"></path>'
               f'<path d="M224,124 L224,144" fill="none" stroke="#38d0b0" stroke-width="0.5" stroke-dasharray="1.5 1"></path>'
               f'<path d="M217,112 Q224,112 224,119 L224,124 M231,112 Q224,112 224,119 M217,144 Q224,144 224,137 L224,124 M231,144 Q224,144 224,137" fill="none" stroke="{Y}" stroke-width="0.6" stroke-linecap="round"></path>'
               f'<rect x="85" y="74" width="22" height="26" fill="rgba(255,122,107,0.35)" stroke="#ff7a6b" stroke-width="0.6"></rect>'
               f'<rect x="196" y="74" width="22" height="26" fill="rgba(56,208,176,0.3)" stroke="#38d0b0" stroke-width="0.6"></rect>')
    mapW = 1164
    mapH = round(mapW * WH / WW)
    labels = (tip('TAXIWAY · 3 tiles · 1,800 · +30/day<br>Joins taxilane and Taxiway A (curves added)', f'{pin(232, 128)}; transform: translate(10px, -50%)')
              + tip('<b>Can’t place:</b> overlaps Stand 2', f'{pin(96, 100)}; transform: translate(-50%, 6px)')
              + tip('MEDIUM STAND 6 · valid · 20,000', f'{pin(207, 70)}; transform: translate(-50%, -110%)')
              + chip(f'LOCKED LAND · <span style="color: {B_TEAL}">buy plot 48,000</span>', B_TEXT, f'{pin(240, 10)}'))
    checks = [('Connects at both ends', True), ('One width fits all aircraft', True), ('Inside owned land', True), ('Crosses no Runway', True)]
    side = (f'<div style="position: absolute; right: 12px; top: 12px; width: 250px; display: flex; flex-direction: column; gap: 8px">'
            + b_panel('Pending', f'<div style="padding: 10px 12px; {B_MONO}; font-size: 12px; display: flex; flex-direction: column; gap: 6px">'
                      f'<div style="display: flex; justify-content: space-between"><span>Medium Stand 6</span><b>20,000</b></div>'
                      f'<div style="display: flex; justify-content: space-between"><span>Taxiway × 3</span><b>1,800</b></div>'
                      f'<div style="display: flex; justify-content: space-between; border-top: 1px solid {B_LINE}; padding-top: 6px"><span style="color: {B_MUTE}">Total</span><b style="color: {B_TEAL}">21,800</b></div></div>')
            + b_panel('Checks · Taxiway', f'<div style="padding: 10px 12px; {B_MONO}; font-size: 12px; display: flex; flex-direction: column; gap: 6px">'
                      + ''.join(f'<div style="display: flex; gap: 8px; align-items: center">{icon("check" if ok else "close", 14, B_TEAL if ok else B_RED)}<span>{t}</span></div>' for t, ok in checks) + '</div>')
            + '</div>')
    keys = ''.join(f'<span style="display: flex; align-items: center; gap: 6px"><span style="border: 1px solid {B_LINE}; border-radius: 3px; padding: 2px 6px; color: {B_TEXT}">{k}</span>{v}</span>'
                   for k, v in [('R', 'rotate'), ('Ctrl Z', 'undo'), ('Esc', 'cancel'), ('Shift-drag', 'straight line'), ('Tab', 'hide palette')])
    top = (f'<div style="{B_MONO}; font-size: 16px; font-weight: 700; color: {B_TEAL}">PLAN</div>' + f'<div style="display: flex">{tabs("BUILD")}</div>'
           + f'<div style="{B_MONO}; font-size: 13px; display: flex; align-items: center; gap: 6px">{icon("coin", 16, B_MUTE)}<b>146,670</b></div>'
           + f'<div style="{B_MONO}; font-size: 12px; color: {B_MUTE}">Space 41/48 · Upkeep 8,180/day</div>'
           + '<div style="flex: 1"></div>'
           + f'{btn("UNDO")}<button type="button" style="height: 36px; padding: 0 16px; border: 1px solid {B_TEAL}; background: {B_TEAL}; color: {B_BG}; border-radius: 4px; {B_MONO}; font-size: 13px; font-weight: 700">CONFIRM 21,800</button>')
    root = (f'<div style="width: {W}px; height: {H}px; background: {B_BG}; color: {B_TEXT}; {B_FONT}; display: flex; flex-direction: column; overflow: hidden">'
            + topbar(top)
            + '<div style="flex: 1; display: flex; gap: 10px; padding: 10px; min-height: 0">'
            + f'<div style="width: 236px; flex: none">{b_panel("Build tools", f"<div style=\"padding: 2px 6px 6px; display: flex; flex-direction: column; gap: 2px\">{pal}</div>")}</div>'
            + f'<div style="display: flex; flex-direction: column; gap: 6px"><div style="position: relative; width: {mapW}px; height: {mapH}px; border: 1px solid {B_LINE}; border-radius: 6px; overflow: hidden">'
            + scene3.svg(mapW, mapH, mode='build', overlay=overlay, label='Airfield in Build Mode with grid') + labels + side + '</div>'
            + f'<div style="display: flex; gap: 16px; {B_MONO}; font-size: 11px; color: {B_MUTE}; padding: 0 2px">{keys}</div></div>'
            + '</div></div>')
    return page('ATC Console · Build Mode (v3)', B_F, CSS, root)
