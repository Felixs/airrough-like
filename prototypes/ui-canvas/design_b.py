from design_gen import svg, icon, page, W, H, grid_overlay

B_BG, B_PANEL, B_LINE, B_TEXT, B_MUTE, B_TEAL, B_AMBER, B_RED = '#0b1210', '#111a17', '#22302b', '#d6e9e3', '#8fa8a0', '#38d0b0', '#f2a33a', '#ff7a6b'
B_F = "family=JetBrains+Mono:wght@400;600;700&family=Inter:wght@400;500;600;700"
B_FONT = "font-family: Inter, system-ui, sans-serif"
B_MONO = "font-family: 'JetBrains Mono', ui-monospace, monospace"
CSS = "button{font:inherit;cursor:pointer}"


def b_panel(title, body, extra=''):
    return (f'<div style="background: {B_PANEL}; border: 1px solid {B_LINE}; border-radius: 6px; display: flex; flex-direction: column; {extra}">'
            f'<div style="{B_MONO}; font-size: 11px; letter-spacing: 1.5px; color: {B_MUTE}; padding: 8px 12px; border-bottom: 1px solid {B_LINE}; text-transform: uppercase">{title}</div>'
            f'{body}</div>')


def strip(cs, typ, size, state, fuel, col, note=''):
    fuelcol = B_RED if 0 < fuel < 12 else B_TEXT
    fuelTxt = f'{fuel}m' if fuel else '—'
    return (f'<div style="display: grid; grid-template-columns: 6px 96px minmax(0, 1fr) 60px; border: 1px solid {B_LINE}; border-radius: 3px; background: #0e1714; {B_MONO}; font-size: 12px">'
            f'<div style="background: {col}"></div>'
            f'<div style="padding: 6px 8px; border-right: 1px solid {B_LINE}; display: flex; flex-direction: column; gap: 2px"><b style="color: {B_TEXT}">{cs}</b><span style="color: {B_MUTE}; font-size: 11px">{typ}</span></div>'
            f'<div style="padding: 6px 8px; display: flex; flex-direction: column; gap: 2px"><span style="color: {B_TEXT}">{state}</span><span style="color: {B_RED if note else B_MUTE}; font-size: 11px">{note or size}</span></div>'
            f'<div style="padding: 6px 8px; border-left: 1px solid {B_LINE}; display: flex; flex-direction: column; gap: 2px; align-items: flex-end"><span style="color: {B_MUTE}; font-size: 10px">FUEL</span><b style="color: {fuelcol}">{fuelTxt}</b></div>'
            '</div>')


def topbar(left_extra):
    return (f'<div style="height: 52px; border-bottom: 1px solid {B_LINE}; display: flex; align-items: center; gap: 28px; padding: 0 16px">{left_extra}</div>')


def btn(label, on=False, aria=None):
    a = f' aria-label="{aria}"' if aria else ''
    return (f'<button type="button"{a} style="height: 36px; min-width: 40px; padding: 0 10px; border: 1px solid {B_TEAL if on else B_LINE}; background: {"#12302a" if on else "transparent"}; '
            f'color: {B_TEAL if on else B_TEXT}; border-radius: 4px; {B_MONO}; font-size: 12px; display: flex; align-items: center; justify-content: center; gap: 6px">{label}</button>')


def B_live():
    inbound = strip('DLH 4TK', 'A320', 'MED · PAX', 'ETA 14:41', 45, B_MUTE) + strip('CLX 77F', 'B747-8F', 'LRG · CGO', 'ETA 14:52', 55, B_MUTE)
    holding = (strip('LOG 9Q', 'Dash 8-Q400', 'SML · PAX', 'HOLD #1 · R1', 9, B_RED, 'LOW FUEL · PRIORITY')
               + strip('BAW 2P', 'B777-300ER', 'LRG · PAX', 'HOLD #2 · R1', 38, B_AMBER)
               + strip('EZY 81', 'A320', 'MED · PAX', 'HOLD #3 · R1', 21, B_AMBER))
    ground = (strip('AFR 12', 'A320', 'MED · PAX', 'TAXI → C2', 0, B_TEAL)
              + strip('UPS 3', 'B737-800BCF', 'MED · CGO', 'BAY B1 · wait CG2', 0, B_TEAL)
              + strip('KLM 66', 'B737-800', 'MED · PAX', 'QUEUE R1 #1', 0, B_TEAL))
    overlay = (f'<circle cx="170" cy="32" r="16" fill="none" stroke="{B_AMBER}" stroke-width="0.6" stroke-dasharray="2 1.5"></circle>'
               f'<path d="M-20 112 L12 112" stroke="{B_TEAL}" stroke-width="0.6" stroke-dasharray="2 1.5"></path>'
               f'<rect x="12" y="102.5" width="200" height="19" fill="none" stroke="{B_TEAL}" stroke-width="0.5"></rect>')
    st = [('C1', 'M', 1), ('C2', 'M', 0), ('C3', 'M', 1), ('C4', 'S', 1), ('CG1', 'L', 1), ('CG2', 'M', 1), ('R1', 'M', 0), ('R2', 'M', 1), ('B1', 'M', 1)]
    stHtml = ''.join(
        f'<div style="border: 1px solid {B_TEAL if o else B_LINE}; background: {"#12302a" if o else "transparent"}; border-radius: 3px; padding: 6px; {B_MONO}; font-size: 11px; display: flex; flex-direction: column; gap: 2px">'
        f'<b style="color: {B_TEXT}">{n}</b><span style="color: {B_MUTE}">{z} · {"busy" if o else "free"}</span></div>' for n, z, o in st)
    acts = [('G', 'Ground Stop', 'ready'), ('P', 'Priority Landing', 'ready'), ('D', 'Manual Divert', '14m'), ('R', 'Rush Turnaround', 'ready')]
    actHtml = ''.join(
        f'<button type="button" style="display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 10px; background: transparent; border: 1px solid {B_LINE}; border-radius: 4px; color: {B_TEXT if r == "ready" else B_MUTE}; {B_MONO}; font-size: 12px">'
        f'<span style="width: 22px; height: 22px; border: 1px solid {B_TEAL if r == "ready" else B_LINE}; border-radius: 3px; display: flex; align-items: center; justify-content: center; color: {B_TEAL if r == "ready" else B_MUTE}">{k}</span>'
        f'<span style="flex: 1; text-align: left">{n}</span><span style="color: {B_MUTE}">{r}</span></button>' for k, n, r in acts)
    hours = list(range(5, 24))
    vals = [0, 4, 9, 12, 10, 7, 6, 6, 7, 8, 3, 0, 0, 0, 0, 0, 0, 0, 0]
    proj = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 7, 9, 11, 10, 7, 5, 3, 1]
    bars = ''.join(
        f'<div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px"><div style="height: 62px; width: 100%; display: flex; align-items: flex-end; justify-content: center">'
        f'<div style="width: 70%; height: {max(v, q) * 5}px; background: {B_TEAL if v else "transparent"}; border: 1px {"solid" if v else "dashed"} {B_TEAL if v else B_MUTE}; border-radius: 2px 2px 0 0"></div></div>'
        f'<span style="{B_MONO}; font-size: 10px; color: {B_MUTE}">{h:02d}</span></div>' for h, v, q in zip(hours, vals, proj))
    top = (f'<div style="{B_MONO}; font-size: 22px; font-weight: 700; color: {B_TEAL}">14:37:15</div>'
           f'<div style="{B_MONO}; font-size: 12px; color: {B_MUTE}">WK2 · SAT · RUSH DAY</div>'
           f'<div style="{B_MONO}; font-size: 13px">QUOTA <b>096/150</b> <span style="color: {B_AMBER}">PACE −8</span></div>'
           f'<div style="{B_MONO}; font-size: 13px">MONEY <b>184,250</b></div>'
           f'<div style="{B_MONO}; font-size: 13px">RISK <b style="color: {B_AMBER}">MED 6.1%</b></div>'
           f'<div style="{B_MONO}; font-size: 13px">AIR <b>4/6</b></div>'
           '<div style="flex: 1"></div>'
           f'<div style="display: flex; gap: 4px">{btn(icon("pause", 18), aria="Pause")}{btn("1×", True)}{btn("2×")}{btn("4×")}</div>')
    root = (f'<div style="width: {W}px; height: {H}px; background: {B_BG}; color: {B_TEXT}; {B_FONT}; display: flex; flex-direction: column; overflow: hidden">'
            + topbar(top)
            + '<div style="flex: 1; display: grid; grid-template-columns: 360px minmax(0, 1fr) 320px; gap: 10px; padding: 10px; min-height: 0">'
            + '<div style="display: flex; flex-direction: column; gap: 10px; min-height: 0">'
            + b_panel('Inbound · 12 next hour', f'<div style="padding: 8px; display: flex; flex-direction: column; gap: 6px">{inbound}</div>')
            + b_panel('Holding · R1', f'<div style="padding: 8px; display: flex; flex-direction: column; gap: 6px">{holding}</div>')
            + b_panel('Ground', f'<div style="padding: 8px; display: flex; flex-direction: column; gap: 6px">{ground}</div>')
            + '</div>'
            + f'<div style="border: 1px solid {B_LINE}; border-radius: 6px; overflow: hidden; position: relative">'
            + svg('night', 720, 580, overlay=overlay, label='Night view of the airport with radar overlays')
            + f'<div style="position: absolute; left: 12px; top: 12px; {B_MONO}; font-size: 11px; color: {B_TEAL}; background: rgba(11,18,16,0.85); padding: 4px 8px; border: 1px solid {B_LINE}">R1 · 27 · ACTIVE · SEP LDG 3:15 / TKO 2:26</div>'
            + f'<div style="position: absolute; right: 12px; top: 12px; {B_MONO}; font-size: 11px; color: {B_AMBER}; background: rgba(11,18,16,0.85); padding: 4px 8px; border: 1px solid {B_LINE}">WIND 270/12 · SUN: WIND SHIFT 14:00</div>'
            + '</div>'
            + '<div style="display: flex; flex-direction: column; gap: 10px; min-height: 0">'
            + b_panel('Stands · Holding Bays', f'<div style="padding: 8px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px">{stHtml}</div>')
            + b_panel('Emergency Actions', f'<div style="padding: 8px; display: flex; flex-direction: column; gap: 6px">{actHtml}</div>')
            + b_panel('Alerts', f'<div style="padding: 10px 12px; {B_MONO}; font-size: 12px; display: flex; flex-direction: column; gap: 6px"><span style="color: {B_RED}">14:36 LOG 9Q LOW FUEL · 9 MIN</span><span style="color: {B_AMBER}">14:31 GO-AROUND EZY 81</span><span style="color: {B_MUTE}">14:22 INCIDENT TWY · CLEARED</span></div>')
            + '</div></div>'
            + f'<div style="height: 118px; border-top: 1px solid {B_LINE}; padding: 10px 16px; display: flex; gap: 16px; align-items: stretch">'
            + f'<div style="width: 190px; display: flex; flex-direction: column; justify-content: center; gap: 4px; {B_MONO}; font-size: 12px"><span style="color: {B_MUTE}">MOVEMENTS / HOUR</span>'
            + f'<span><span style="color: {B_TEAL}">■</span> done · <span style="color: {B_MUTE}">□</span> forecast</span><span style="color: {B_AMBER}">need 54 more by 24:00</span></div>'
            + f'<div style="flex: 1; display: flex; gap: 4px; align-items: flex-end">{bars}</div>'
            + '</div></div>')
    return page('ATC Console · Live Day', B_F, CSS, root)


def B_plan():
    # Run Calendar table
    weeks = [
        [('58/45', 'ok'), ('61/48', 'ok'), ('66/50', 'ok'), ('67/53', 'ok'), ('85/62', 'ok'), ('121/90', 'ok'), ('91/86', 'ok')],
        [('96/75', 'ok'), ('103/90', 'ok'), ('106/83', 'ok'), ('106/86', 'ok'), ('127/90', 'ok'), ('212/150', 'ok'), ('170/144', 'ok')],
        [('Q105', 'next'), ('Q111', ''), ('Q116', ''), ('Q122', 'tw'), ('Q126', ''), ('Q210', 'rush'), ('Q202', 'boss')],
        [('', 'lock')] * 7,
    ]
    names = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
    cal = f'<div style="display: grid; grid-template-columns: 48px repeat(7, minmax(0, 1fr)); gap: 4px; {B_MONO}; font-size: 12px">'
    cal += '<div></div>' + ''.join(f'<div style="color: {B_MUTE}; text-align: center; padding: 4px 0">{n}</div>' for n in names)
    for wi, row in enumerate(weeks):
        cal += f'<div style="color: {B_MUTE}; display: flex; align-items: center">WK{wi + 1}</div>'
        for v, k in row:
            if k == 'lock':
                cal += f'<div style="height: 52px; border: 1px dashed {B_LINE}; border-radius: 3px"></div>'
                continue
            col = {'ok': B_TEAL, 'next': B_TEXT, 'tw': B_AMBER, 'rush': B_AMBER, 'boss': B_RED, '': B_MUTE}[k]
            tag = {'ok': 'MET', 'next': 'NEXT', 'tw': 'TAXIWAY WORKS', 'rush': 'RUSH', 'boss': 'STORM · ILS', '': ''}[k]
            cal += (f'<div style="height: 52px; border: 1px solid {col if k in ("next", "boss") else B_LINE}; background: {"#12302a" if k == "next" else "#0e1714"}; border-radius: 3px; padding: 6px; display: flex; flex-direction: column; justify-content: space-between">'
                    f'<b style="color: {B_TEXT if k != "ok" else B_MUTE}">{v}</b><span style="color: {col}; font-size: 10px">{tag}</span></div>')
    cal += '</div>'
    rows = [
        ('Runways', 'R1 Long Lit → ILS', '80,000', '+500', '0', 'Storm Boss Day needs ILS', True),
        ('Runways', 'New Medium Asphalt Runway (#2)', '100,000', '+1,700', '8', 'Second Runway; needs Land', False),
        ('Stands', 'Large Contact Stand (#3)', '56,300', '+250', '1', '+6 Large flights/Day', False),
        ('Stands', 'Medium Cargo Hub Stand (#3)', '25,000', '+250', '1', '+8 Medium cargo/Day', False),
        ('Holding Bays', 'Large Holding Bay', '16,000', '+80', '1', 'Lets Large land when Stands are full', False),
        ('ATC Tower', 'Radar 2 → 3', '24,000', '+200', '0', 'Fuel + Emergency Alerts · Separation −15 s', False),
        ('ATC Tower', 'Controller Training 2 → 3', '24,000', '+200', '0', 'ATC Error −15% · Separation −15 s', False),
        ('Safety', 'Fire & Rescue 1 → 2', '12,000', '+300', '0', 'Crash blockage 45 → 33 min', False),
        ('Land', 'Land Plot (+12 space)', '48,000', '—', '+12', 'Space 41/48 → 41/60', False),
    ]
    th = ''.join(f'<th style="text-align: {a}; padding: 8px 10px; color: {B_MUTE}; font-weight: 600; font-size: 11px; letter-spacing: 1px; border-bottom: 1px solid {B_LINE}">{h}</th>'
                 for h, a in [('CATEGORY', 'left'), ('ITEM', 'left'), ('COST', 'right'), ('UPKEEP', 'right'), ('SPACE', 'right'), ('EFFECT', 'left'), ('', 'right')])
    tr = ''.join(
        f'<tr style="background: {"#16251f" if hl else "transparent"}">'
        f'<td style="padding: 8px 10px; color: {B_MUTE}; border-bottom: 1px solid {B_LINE}">{c}</td>'
        f'<td style="padding: 8px 10px; border-bottom: 1px solid {B_LINE}; color: {B_TEXT}"><b>{n}</b></td>'
        f'<td style="padding: 8px 10px; text-align: right; border-bottom: 1px solid {B_LINE}">{cost}</td>'
        f'<td style="padding: 8px 10px; text-align: right; color: {B_MUTE}; border-bottom: 1px solid {B_LINE}">{up}</td>'
        f'<td style="padding: 8px 10px; text-align: right; color: {B_MUTE}; border-bottom: 1px solid {B_LINE}">{sp}</td>'
        f'<td style="padding: 8px 10px; color: {B_AMBER if hl else B_MUTE}; border-bottom: 1px solid {B_LINE}">{eff}</td>'
        f'<td style="padding: 6px 10px; text-align: right; border-bottom: 1px solid {B_LINE}">{btn("BUY", hl)}</td></tr>'
        for c, n, cost, up, sp, eff, hl in rows)
    table = f'<table style="width: 100%; border-collapse: collapse; {B_MONO}; font-size: 12px"><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table>'
    forecast = (f'<div style="padding: 12px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; {B_MONO}; font-size: 12px">'
                + ''.join(f'<div style="display: flex; flex-direction: column; gap: 2px"><span style="color: {B_MUTE}; font-size: 11px">{k}</span><b style="font-size: 15px; color: {c}">{v}</b></div>'
                          for k, v, c in [('DAILY QUOTA', '105 MOV', B_TEXT), ('DEMAND', '70 FLIGHTS', B_TEXT), ('COMING', '28 S · 31 M · 11 L', B_TEXT),
                                          ('TURNED AWAY', '0 · stands OK', B_TEAL), ('PEAKS', '08–10 · 17–19', B_TEXT), ('PROJECTED', '~148 MOV', B_TEAL)])
                + '</div>')
    top = (f'<div style="{B_MONO}; font-size: 18px; font-weight: 700; color: {B_TEAL}">PLAN</div>'
           f'<div style="{B_MONO}; font-size: 12px; color: {B_MUTE}">NEXT: WK3 · MON</div>'
           f'<div style="{B_MONO}; font-size: 13px">MONEY <b>146,670</b></div>'
           f'<div style="{B_MONO}; font-size: 13px">UPKEEP <b>8,180</b>/DAY</div>'
           f'<div style="{B_MONO}; font-size: 13px">SPACE <b>41/48</b></div>'
           f'<div style="{B_MONO}; font-size: 13px">CRASHES WK <b>0</b></div>'
           '<div style="flex: 1"></div>'
           f'<button type="button" style="height: 36px; padding: 0 16px; border: 1px solid {B_TEAL}; background: {B_TEAL}; color: {B_BG}; border-radius: 4px; {B_MONO}; font-size: 13px; font-weight: 700; display: flex; align-items: center; gap: 8px">{icon("play", 16, B_BG)}START MONDAY</button>')
    mini = svg('night', 380, 230, overlay=grid_overlay('rgba(56,208,176,0.12)'), label='Airport schematic')
    root = (f'<div style="width: {W}px; height: {H}px; background: {B_BG}; color: {B_TEXT}; {B_FONT}; display: flex; flex-direction: column; overflow: hidden">'
            + topbar(top)
            + '<div style="flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 10px; padding: 10px; min-height: 0">'
            + '<div style="display: flex; flex-direction: column; gap: 10px; min-height: 0">'
            + b_panel('Run Calendar · Week 3 open · Week 4 locked', f'<div style="padding: 10px">{cal}</div>')
            + b_panel('Build · sorted by Boss Day relevance', f'<div style="overflow: hidden">{table}</div>', 'flex: 1; min-height: 0')
            + '</div>'
            + '<div style="display: flex; flex-direction: column; gap: 10px; min-height: 0">'
            + b_panel('Forecast · Monday', forecast)
            + b_panel('Airport', f'<div style="padding: 10px">{mini}</div>')
            + b_panel('Boss Day · Sunday', f'<div style="padding: 12px; {B_MONO}; font-size: 12px; display: flex; flex-direction: column; gap: 6px"><b style="color: {B_RED}">STORM · WEATHER SEV 3</b><span style="color: {B_MUTE}">13–17h: only ILS Runways take landings. Wind Shift 15:00.</span><span style="color: {B_AMBER}">You have 0 ILS Runways.</span></div>')
            + '</div></div></div>')
    return page('ATC Console · Plan Mode', B_F, CSS, root)
