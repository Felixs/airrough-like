"""Direction B v2: zoomed-out airfield, decluttered panels, new Build Mode."""
from design_gen import icon, page, W, H
from design_b import B_BG, B_PANEL, B_LINE, B_TEXT, B_MUTE, B_TEAL, B_AMBER, B_RED, B_F, B_FONT, B_MONO, CSS, b_panel, btn, topbar
import scene2

WW, WH = scene2.WW, scene2.WH


def pin(x, y):
    """Position inside the map box in % of world coords."""
    return f'left: {x / WW * 100:.2f}%; top: {y / WH * 100:.2f}%'


def tip(text, extra=''):
    return (f'<div style="position: absolute; z-index: 3; background: #e6f4ef; color: #0b1210; {B_MONO}; font-size: 11px; line-height: 1.45; padding: 8px 10px; border-radius: 4px; '
            f'box-shadow: 0 6px 18px rgba(0,0,0,0.5); white-space: nowrap; {extra}">{text}</div>')


def strip2(cs, typ, state, col, fuel=None, warn=False):
    f = (f'<b style="color: {B_RED if warn else B_TEXT}">{fuel}m</b>' if fuel is not None else '')
    return (f'<div style="display: grid; grid-template-columns: 5px minmax(0, 1fr) auto; align-items: center; border: 1px solid {B_RED if warn else B_LINE}; border-radius: 3px; background: #0e1714; {B_MONO}; font-size: 12px">'
            f'<div style="background: {col}; align-self: stretch"></div>'
            f'<div style="padding: 6px 8px; display: flex; flex-direction: column; gap: 1px"><span><b style="color: {B_TEXT}">{cs}</b> <span style="color: {B_MUTE}">{typ}</span></span>'
            f'<span style="color: {B_RED if warn else B_MUTE}; font-size: 11px">{state}</span></div>'
            f'<div style="padding: 6px 10px">{f}</div></div>')


def tabs(active):
    return ''.join(f'<button type="button" style="height: 52px; padding: 0 18px; border: 0; border-bottom: 2px solid {B_TEAL if t == active else "transparent"}; background: transparent; '
                   f'color: {B_TEXT if t == active else B_MUTE}; {B_MONO}; font-size: 13px; font-weight: 700; letter-spacing: 1px">{t}</button>' for t in ('OVERVIEW', 'BUILD'))


# ---------------------------------------------------------------- Live Day
def B_live():
    left = (b_panel('Inbound', '<div style="padding: 8px; display: flex; flex-direction: column; gap: 6px">'
                    + strip2('DLH 4TK', 'A320', 'ETA 14:41', B_MUTE) + strip2('CLX 77F', 'B747-8F', 'ETA 14:52', B_MUTE) + '</div>')
            + b_panel('Holding · R1', '<div style="padding: 8px; display: flex; flex-direction: column; gap: 6px">'
                      + strip2('LOG 9Q', 'Q400', '#1 · priority (low fuel)', B_RED, 9, True)
                      + strip2('BAW 2P', 'B777', '#2', B_AMBER, 38) + strip2('EZY 81', 'A320', '#3', B_AMBER, 21) + '</div>')
            + b_panel('Ground', '<div style="padding: 8px; display: flex; flex-direction: column; gap: 6px">'
                      + strip2('AFR 12', 'A320', 'taxi → stand C3', B_TEAL) + strip2('UPS 3', 'B737F', 'Holding Bay · waits for cargo stand', B_TEAL)
                      + strip2('KLM 66', 'Q400', 'lined up R1', B_TEAL) + '</div>'))
    mapW = 780
    mapH = round(mapW * WH / WW)
    labels = (f'<div style="position: absolute; {pin(96, 136)}; transform: translate(-50%, -130%); {B_MONO}; font-size: 10px; color: {B_TEAL}">LANDING DLH 2A</div>'
              f'<div style="position: absolute; {pin(28, 56)}; transform: translate(-30%, -120%); {B_MONO}; font-size: 10px; color: {B_AMBER}">BAY · UPS 3</div>')
    center = (f'<div style="display: flex; flex-direction: column; gap: 8px; min-height: 0">'
              f'<div style="position: relative; width: {mapW}px; height: {mapH}px; border: 1px solid {B_LINE}; border-radius: 6px; overflow: hidden">{scene2.svg(mapW, mapH)}{labels}</div>'
              f'<div style="display: flex; gap: 8px; {B_MONO}; font-size: 12px">'
              + ''.join(f'<div style="flex: 1; border: 1px solid {B_LINE}; border-radius: 4px; padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; background: {B_PANEL}">'
                        f'<span style="color: {B_MUTE}; font-size: 11px">{k}</span><b style="color: {c}">{v}</b></div>'
                        for k, v, c in [('R1 · 27', 'ACTIVE', B_TEAL), ('SEPARATION', 'LDG 3:15 · TKO 2:26', B_TEXT), ('WIND', '270 / 12 kt', B_TEXT), ('RISK', 'MEDIUM', B_AMBER)])
              + '</div></div>')
    acts = [('G', 'Ground Stop', 'ready'), ('P', 'Priority Landing', 'ready'), ('D', 'Manual Divert', '14m'), ('R', 'Rush Turnaround', 'ready')]
    actHtml = ''.join(
        f'<button type="button" style="display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 10px; background: transparent; border: 1px solid {B_LINE}; border-radius: 4px; color: {B_TEXT if s == "ready" else B_MUTE}; {B_MONO}; font-size: 12px">'
        f'<span style="width: 22px; height: 22px; border: 1px solid {B_TEAL if s == "ready" else B_LINE}; border-radius: 3px; display: flex; align-items: center; justify-content: center; color: {B_TEAL if s == "ready" else B_MUTE}">{k}</span>'
        f'<span style="flex: 1; text-align: left">{n}</span><span style="color: {B_MUTE}">{s}</span></button>' for k, n, s in acts)
    stands = [('C1', 1), ('C2', 1), ('C3', 0), ('CL', 1), ('CG1', 1), ('CGL', 1), ('R1', 0), ('B1', 1), ('B2', 0)]
    stHtml = ''.join(f'<span style="{B_MONO}; font-size: 11px; padding: 4px 6px; border-radius: 3px; border: 1px solid {B_TEAL if o else B_LINE}; color: {B_TEXT if o else B_MUTE}; background: {"#12302a" if o else "transparent"}">{n}</span>' for n, o in stands)
    right = (b_panel('Emergency Actions', f'<div style="padding: 8px; display: flex; flex-direction: column; gap: 6px">{actHtml}</div>')
             + b_panel('Alerts', f'<div style="padding: 10px 12px; {B_MONO}; font-size: 12px; display: flex; flex-direction: column; gap: 6px"><span style="color: {B_RED}">14:36 LOG 9Q low fuel · 9 min</span><span style="color: {B_AMBER}">14:31 Go-Around EZY 81</span><span style="color: {B_MUTE}">14:22 Taxiway Incident · cleared</span></div>')
             + b_panel('Stands · Bays  6/9 busy', f'<div style="padding: 10px; display: flex; flex-wrap: wrap; gap: 6px; position: relative">{stHtml}'
                       + tip('C3 · Medium Contact Stand<br>free · next: AFR 12 (taxiing)', 'right: 8px; bottom: 44px') + '</div>'))
    hours = list(range(5, 24))
    vals = [0, 4, 9, 12, 10, 7, 6, 6, 7, 8, 3, 0, 0, 0, 0, 0, 0, 0, 0]
    proj = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 7, 9, 11, 10, 7, 5, 3, 1]
    bars = ''.join(
        f'<div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px"><div style="height: 56px; width: 100%; display: flex; align-items: flex-end; justify-content: center">'
        f'<div style="width: 70%; height: {max(v, q) * 4.5}px; background: {B_TEAL if v else "transparent"}; border: 1px {"solid" if v else "dashed"} {B_TEAL if v else B_MUTE}; border-radius: 2px 2px 0 0"></div></div>'
        f'<span style="{B_MONO}; font-size: 10px; color: {B_MUTE}">{h:02d}</span></div>' for h, v, q in zip(hours, vals, proj))
    quota = (f'<div style="position: relative; display: flex; flex-direction: column; gap: 4px; width: 280px"><div style="display: flex; justify-content: space-between; {B_MONO}; font-size: 12px"><span style="color: {B_MUTE}">QUOTA</span><b>96 / 150</b></div>'
             f'<div style="height: 8px; background: {B_LINE}; border-radius: 2px; position: relative"><div style="position: absolute; left: 0; top: 0; bottom: 0; width: 64%; background: {B_TEAL}; border-radius: 2px"></div>'
             f'<div style="position: absolute; left: 69%; top: -3px; bottom: -3px; width: 2px; background: {B_AMBER}"></div></div>'
             + tip('Pace −8 vs. where you should be now<br>Need 54 more Movements by 24:00', 'top: 34px; left: 120px') + '</div>')
    top = (f'<div style="{B_MONO}; font-size: 22px; font-weight: 700; color: {B_TEAL}">14:37</div>'
           f'<div style="{B_MONO}; font-size: 12px; color: {B_MUTE}">WK2 · SAT · RUSH DAY</div>' + quota
           + f'<div style="{B_MONO}; font-size: 13px; display: flex; align-items: center; gap: 6px">{icon("coin", 16, B_MUTE)}<b>184,250</b></div>'
           + '<div style="flex: 1"></div>'
           + f'<div style="display: flex; gap: 4px">{btn(icon("pause", 18), aria="Pause")}{btn("1×", True)}{btn("2×")}{btn("4×")}</div>')
    root = (f'<div style="width: {W}px; height: {H}px; background: {B_BG}; color: {B_TEXT}; {B_FONT}; display: flex; flex-direction: column; overflow: hidden">'
            + topbar(top)
            + f'<div style="flex: 1; display: grid; grid-template-columns: 300px {mapW}px minmax(0, 1fr); gap: 10px; padding: 10px; min-height: 0">'
            + f'<div style="display: flex; flex-direction: column; gap: 10px; min-height: 0">{left}</div>' + center
            + f'<div style="display: flex; flex-direction: column; gap: 10px; min-height: 0">{right}</div></div>'
            + f'<div style="height: 104px; border-top: 1px solid {B_LINE}; padding: 10px 16px; display: flex; gap: 16px; align-items: stretch">'
            + f'<div style="width: 170px; display: flex; flex-direction: column; justify-content: center; gap: 4px; {B_MONO}; font-size: 12px"><span style="color: {B_MUTE}">MOVEMENTS / HOUR</span><span><span style="color: {B_TEAL}">■</span> done · <span style="color: {B_MUTE}">□</span> forecast</span></div>'
            + f'<div style="flex: 1; display: flex; gap: 4px; align-items: flex-end">{bars}</div></div></div>')
    return page('ATC Console · Live Day (v2)', B_F, CSS, root)


# ---------------------------------------------------------------- Plan · Overview
def B_plan():
    weeks = [
        [('58', 'ok')] * 7,
        [('170', 'ok')] * 7,
        [('105', 'next'), ('111', ''), ('116', ''), ('122', 'tw'), ('126', ''), ('210', 'rush'), ('202', 'boss')],
        [('', 'lock')] * 7,
    ]
    names = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
    cal = f'<div style="display: grid; grid-template-columns: 44px repeat(7, minmax(0, 1fr)); gap: 4px; {B_MONO}; font-size: 12px; position: relative">'
    cal += '<div></div>' + ''.join(f'<div style="color: {B_MUTE}; text-align: center; padding: 2px 0">{n}</div>' for n in names)
    for wi, row in enumerate(weeks):
        cal += f'<div style="color: {B_MUTE}; display: flex; align-items: center">WK{wi + 1}</div>'
        for v, k in row:
            if k == 'lock':
                cal += f'<div style="height: 40px; border: 1px dashed {B_LINE}; border-radius: 3px"></div>'
            elif k == 'ok':
                cal += f'<div style="height: 40px; border: 1px solid {B_LINE}; border-radius: 3px; display: flex; align-items: center; justify-content: center">{icon("check", 16, B_TEAL)}</div>'
            else:
                col = {'next': B_TEAL, 'tw': B_AMBER, 'rush': B_AMBER, 'boss': B_RED, '': B_LINE}[k]
                ic = {'next': icon('play', 12, B_TEAL), 'tw': icon('taxi', 12, B_AMBER), 'rush': icon('ff', 12, B_AMBER), 'boss': icon('storm', 14, B_RED), '': ''}[k]
                cal += (f'<div style="height: 40px; border: 1px solid {col}; background: {"#12302a" if k == "next" else "transparent"}; border-radius: 3px; padding: 4px 6px; display: flex; align-items: center; justify-content: space-between">'
                        f'<b style="color: {B_TEXT}">Q{v}</b>{ic}</div>')
    cal += tip('SUN · BOSS DAY · Quota 202<br>Storm 13–17h: only ILS Runways land<br>Wind Shift 15:00', 'right: 0; top: 150px') + '</div>'
    rows = [
        ('R1 Long Lit → ILS', '80,000', 'Needed for Sunday’s Storm', True),
        ('Large Contact Stand #3', '56,300', '+6 Large flights per Day', False),
        ('Medium Cargo Hub Stand #3', '25,000', '+8 Medium cargo flights per Day', False),
        ('Radar 2 → 3', '24,000', 'Fuel + Emergency Alerts, faster Separation', False),
        ('Fire & Rescue 1 → 2', '12,000', 'Crash blockage 45 → 33 min', False),
    ]
    tr = ''.join(
        f'<tr style="background: {"#16251f" if hl else "transparent"}">'
        f'<td style="padding: 9px 10px; border-bottom: 1px solid {B_LINE}"><b>{n}</b></td>'
        f'<td style="padding: 9px 10px; text-align: right; border-bottom: 1px solid {B_LINE}">{c}</td>'
        f'<td style="padding: 9px 10px; color: {B_AMBER if hl else B_MUTE}; border-bottom: 1px solid {B_LINE}">{e}</td>'
        f'<td style="padding: 6px 10px; text-align: right; border-bottom: 1px solid {B_LINE}; position: relative">{btn("BUY", hl)}'
        + (tip('Upkeep +500/day · Space 0<br>Pilot Error −40% on R1', 'right: 70px; top: 4px') if hl else '') + '</td></tr>'
        for n, c, e, hl in rows)
    table = f'<table style="width: 100%; border-collapse: collapse; {B_MONO}; font-size: 12px"><tbody>{tr}</tbody></table>'
    forecast = (f'<div style="padding: 12px; display: flex; flex-direction: column; gap: 10px; {B_MONO}; font-size: 12px">'
                + ''.join(f'<div style="display: flex; justify-content: space-between"><span style="color: {B_MUTE}">{k}</span><b style="color: {c}">{v}</b></div>'
                          for k, v, c in [('QUOTA', '105 Movements', B_TEXT), ('COMING', '28 S · 31 M · 11 L', B_TEXT), ('TURNED AWAY', 'none', B_TEAL), ('PROJECTED', '~148 Movements', B_TEAL)])
                + '</div>')
    top = (f'<div style="{B_MONO}; font-size: 16px; font-weight: 700; color: {B_TEAL}">PLAN</div>' + f'<div style="display: flex">{tabs("OVERVIEW")}</div>'
           + f'<div style="{B_MONO}; font-size: 13px; display: flex; align-items: center; gap: 6px">{icon("coin", 16, B_MUTE)}<b>146,670</b></div>'
           + f'<div style="{B_MONO}; font-size: 12px; color: {B_MUTE}">Upkeep 8,180/day</div>'
           + '<div style="flex: 1"></div>'
           + f'<button type="button" style="height: 36px; padding: 0 16px; border: 1px solid {B_TEAL}; background: {B_TEAL}; color: {B_BG}; border-radius: 4px; {B_MONO}; font-size: 13px; font-weight: 700; display: flex; align-items: center; gap: 8px">{icon("play", 16, B_BG)}START WK3 MON</button>')
    root = (f'<div style="width: {W}px; height: {H}px; background: {B_BG}; color: {B_TEXT}; {B_FONT}; display: flex; flex-direction: column; overflow: hidden">'
            + topbar(top)
            + '<div style="flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 10px; padding: 10px; min-height: 0">'
            + '<div style="display: flex; flex-direction: column; gap: 10px; min-height: 0">'
            + b_panel('Run Calendar', f'<div style="padding: 10px">{cal}</div>')
            + b_panel('Suggested for this Week', f'<div>{table}</div><div style="padding: 10px 12px; {B_MONO}; font-size: 12px; color: {B_MUTE}">Placing new Runways, Taxiways and Stands happens in BUILD.</div>')
            + '</div>'
            + '<div style="display: flex; flex-direction: column; gap: 10px">'
            + b_panel('Forecast · WK3 Monday', forecast)
            + b_panel('Boss Day · Sunday', f'<div style="padding: 12px; {B_MONO}; font-size: 12px; display: flex; flex-direction: column; gap: 6px"><b style="color: {B_RED}">STORM · WEATHER · SEVERITY 3</b><span style="color: {B_MUTE}">13–17h only ILS Runways take landings.</span><span style="color: {B_AMBER}">You have 0 ILS Runways.</span></div>')
            + '</div></div></div>')
    return page('ATC Console · Plan Overview (v2)', B_F, CSS, root)


# ---------------------------------------------------------------- Plan · Build
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
            pal += (f'<button type="button" style="width: 100%; height: 38px; display: flex; align-items: center; gap: 10px; padding: 0 10px; border-radius: 4px; border: 1px solid {B_TEAL if on else "transparent"}; '
                    f'background: {"#12302a" if on else "transparent"}; color: {B_TEXT}; {B_MONO}; font-size: 12px">{icon(ic, 16, B_TEAL if on else B_MUTE)}<span style="flex: 1; text-align: left">{n}</span><span style="color: {B_MUTE}; font-size: 11px">{c}</span></button>')
    overlay = ('<rect x="256" y="72" width="16" height="48" fill="rgba(56,208,176,0.35)"></rect>'
               '<rect x="256.5" y="72.5" width="15" height="47" fill="none" stroke="#38d0b0" stroke-width="0.8" stroke-dasharray="2 1"></rect>'
               '<rect x="263.7" y="72" width="0.6" height="48" fill="#b08f2c"></rect>'
               '<rect x="152" y="56" width="16" height="16" fill="rgba(56,208,176,0.35)" stroke="#38d0b0" stroke-width="0.8"></rect>'
               '<rect x="96" y="56" width="24" height="24" fill="rgba(255,122,107,0.35)" stroke="#ff7a6b" stroke-width="0.8"></rect>')
    mapW = 880
    mapH = round(mapW * WH / WW)
    labels = (tip('TAXIWAY · drag · 6 tiles<br>3,600 · Upkeep +60/day', f'{pin(272, 76)}; transform: translate(8px, 0)')
              + tip('<b>Can’t place:</b> overlaps Stand C3', f'{pin(96, 82)}; transform: translate(-10%, 6px)')
              + f'<div style="position: absolute; {pin(274, 150)}; {B_MONO}; font-size: 11px; color: {B_TEXT}; background: rgba(11,18,16,0.85); border: 1px solid {B_TEAL}; padding: 6px 8px; border-radius: 4px">LOCKED LAND<br><span style="color: {B_TEAL}">Buy plot · 48,000</span></div>')
    checks = [('Connects to Taxiway at both ends', True), ('Width fits Small–Large aircraft', True), ('Inside owned land', True), ('Crosses no Runway', True)]
    right = (b_panel('Taxiway', f'<div style="padding: 12px; {B_MONO}; font-size: 12px; display: flex; flex-direction: column; gap: 8px">'
                     f'<span style="color: {B_MUTE}">2 tiles wide · fits all aircraft</span>'
                     + ''.join(f'<div style="display: flex; justify-content: space-between"><span style="color: {B_MUTE}">{k}</span><b>{v}</b></div>'
                               for k, v in [('THIS DRAG', '6 tiles'), ('COST', '3,600'), ('UPKEEP', '+60/day')])
                     + '</div>')
             + b_panel('Checks', f'<div style="padding: 12px; {B_MONO}; font-size: 12px; display: flex; flex-direction: column; gap: 8px">'
                       + ''.join(f'<div style="display: flex; gap: 8px; align-items: center">{icon("check" if ok else "close", 14, B_TEAL if ok else B_RED)}<span>{t}</span></div>' for t, ok in checks)
                       + '</div>')
             + b_panel('Pending', f'<div style="padding: 12px; {B_MONO}; font-size: 12px; display: flex; flex-direction: column; gap: 6px">'
                       f'<div style="display: flex; justify-content: space-between"><span>Medium Stand</span><b>20,000</b></div>'
                       f'<div style="display: flex; justify-content: space-between"><span>Taxiway × 6</span><b>3,600</b></div>'
                       f'<div style="display: flex; justify-content: space-between; border-top: 1px solid {B_LINE}; padding-top: 6px"><span style="color: {B_MUTE}">Total</span><b style="color: {B_TEAL}">23,600</b></div>'
                       f'<div style="display: flex; justify-content: space-between"><span style="color: {B_MUTE}">Money after</span><b>123,070</b></div></div>'))
    keys = ''.join(f'<span style="display: flex; align-items: center; gap: 6px"><span style="border: 1px solid {B_LINE}; border-radius: 3px; padding: 2px 6px; color: {B_TEXT}">{k}</span>{v}</span>'
                   for k, v in [('R', 'rotate'), ('Ctrl Z', 'undo'), ('Esc', 'cancel'), ('Shift-drag', 'straight line')])
    top = (f'<div style="{B_MONO}; font-size: 16px; font-weight: 700; color: {B_TEAL}">PLAN</div>' + f'<div style="display: flex">{tabs("BUILD")}</div>'
           + f'<div style="{B_MONO}; font-size: 13px; display: flex; align-items: center; gap: 6px">{icon("coin", 16, B_MUTE)}<b>146,670</b></div>'
           + f'<div style="{B_MONO}; font-size: 12px; color: {B_MUTE}">Space 41/48 · Upkeep 8,180/day</div>'
           + '<div style="flex: 1"></div>'
           + f'{btn("UNDO")}<button type="button" style="height: 36px; padding: 0 16px; border: 1px solid {B_TEAL}; background: {B_TEAL}; color: {B_BG}; border-radius: 4px; {B_MONO}; font-size: 13px; font-weight: 700">CONFIRM 23,600</button>')
    root = (f'<div style="width: {W}px; height: {H}px; background: {B_BG}; color: {B_TEXT}; {B_FONT}; display: flex; flex-direction: column; overflow: hidden">'
            + topbar(top)
            + f'<div style="flex: 1; display: grid; grid-template-columns: 240px {mapW}px minmax(0, 1fr); gap: 10px; padding: 10px; min-height: 0">'
            + b_panel('Build tools', f'<div style="padding: 4px 8px 8px; display: flex; flex-direction: column; gap: 2px">{pal}</div>')
            + f'<div style="display: flex; flex-direction: column; gap: 8px"><div style="position: relative; width: {mapW}px; height: {mapH}px; border: 1px solid {B_LINE}; border-radius: 6px; overflow: hidden">'
            + scene2.svg(mapW, mapH, mode='build', overlay=overlay, label='Airfield in Build Mode with grid') + labels + '</div>'
            + f'<div style="display: flex; gap: 16px; {B_MONO}; font-size: 11px; color: {B_MUTE}; padding: 4px 2px">{keys}</div></div>'
            + f'<div style="display: flex; flex-direction: column; gap: 10px">{right}</div></div></div>')
    return page('ATC Console · Build Mode', B_F, CSS, root)
