from design_gen import svg, icon, page, W, H, grid_overlay

INK, CREAM, CORAL, TEAL, SUN, WATER, WATER2, CLIFF, CLIFF2, MUTE = '#3b3355', '#fffaf0', '#e8705a', '#2f9e8f', '#ffd166', '#8fd3e8', '#7fc6dd', '#c99b6d', '#a87b52', '#6b6485'
C_F = "family=Silkscreen:wght@400;700&family=Nunito:wght@500;700;800"
C_FONT = "font-family: Nunito, system-ui, sans-serif"
C_PIX = "font-family: Silkscreen, Nunito, sans-serif"
CSS = "button{font:inherit;cursor:pointer}"


def water_dots(w, h, n=90, seed=3):
    import random
    r = random.Random(seed)
    return ''.join(f'<rect x="{r.randrange(w)}" y="{r.randrange(h)}" width="{r.choice([6, 10, 14])}" height="3" fill="#b8e6f2"></rect>' for _ in range(n))


def island(x, y, w, h, overlay=''):
    cliff = 44
    return (f'<div style="position: absolute; left: {x + 18}px; top: {y + 30}px; width: {w}px; height: {h + cliff}px; background: rgba(40,60,90,0.18); border-radius: 18px"></div>'
            f'<div style="position: absolute; left: {x}px; top: {y + h - 8}px; width: {w}px; height: {cliff + 8}px; background: {CLIFF}; border-radius: 0 0 16px 16px; overflow: hidden">'
            f'<div style="position: absolute; left: 0; right: 0; top: 22px; height: 6px; background: {CLIFF2}"></div><div style="position: absolute; left: 0; right: 0; top: 38px; height: 4px; background: {CLIFF2}"></div></div>'
            f'<div style="position: absolute; left: {x}px; top: {y}px; width: {w}px; height: {h}px; border-radius: 16px; overflow: hidden; box-shadow: inset 0 0 0 3px rgba(255,255,255,0.35)">{svg("pastel", w, h, overlay=overlay)}</div>')


def card(ic, title, sub, foot, w=168, h=210, tilt=0, dim=False, hl=False, cd=None):
    over = (f'<div style="position: absolute; inset: 0; background: rgba(59,51,85,0.55); border-radius: 14px; display: flex; align-items: center; justify-content: center; color: {CREAM}; {C_PIX}; font-size: 20px">{cd}</div>' if cd else '')
    return (f'<button type="button" style="position: relative; width: {w}px; height: {h}px; transform: rotate({tilt}deg) translateY({abs(tilt) * 3}px); border-radius: 14px; '
            f'border: 3px solid {CORAL if hl else INK}; background: {CREAM}; color: {INK}; padding: 12px; display: flex; flex-direction: column; gap: 8px; text-align: left; box-shadow: 0 6px 0 {INK}">'
            f'<span style="height: 74px; border-radius: 10px; background: {"#ffe6dc" if hl else "#eef6f2"}; display: flex; align-items: center; justify-content: center">{ic}</span>'
            f'<span style="{C_PIX}; font-size: 13px; line-height: 1.2">{title}</span>'
            f'<span style="font-size: 12px; color: {MUTE}; line-height: 1.3">{sub}</span>'
            f'<span style="margin-top: auto; font-weight: 800; font-size: 13px; color: {CORAL if hl else INK}">{foot}</span>{over}</button>')


def ring(pct, size=64, col=TEAL):
    import math
    r = size / 2 - 6
    c = 2 * math.pi * r
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 {size} {size}" role="img" aria-label="Daily Quota {int(pct * 100)}%">'
            f'<circle cx="{size / 2}" cy="{size / 2}" r="{r}" fill="none" stroke="#e7e0d2" stroke-width="7"></circle>'
            f'<circle cx="{size / 2}" cy="{size / 2}" r="{r}" fill="none" stroke="{col}" stroke-width="7" stroke-dasharray="{c * pct:.1f} {c:.1f}" transform="rotate(-90 {size / 2} {size / 2})" stroke-linecap="round"></circle></svg>')


def C_live():
    ox, oy, mw, mh = 200, 120, 1040, 632
    bubble = lambda x, y, txt, col: (f'<div style="position: absolute; left: {x}px; top: {y}px; background: {CREAM}; border: 3px solid {INK}; border-radius: 12px; padding: 4px 10px; '
                                     f'{C_PIX}; font-size: 12px; color: {col}; box-shadow: 0 3px 0 {INK}">{txt}</div>')
    hand = ''.join([
        card(icon('stop', 40, INK), 'Ground Stop', 'Freeze all taxiing for 10 min.', 'READY', 150, 200, -8),
        card(icon('priority', 40, CORAL), 'Priority Landing', 'Lowest-fuel plane lands next.', 'READY', 150, 200, -3, hl=True),
        card(icon('divert', 40, INK), 'Manual Divert', 'Send one plane away. No fees.', '14 MIN', 150, 200, 3, cd='14:00'),
        card(icon('rush', 40, INK), 'Rush Turnaround', 'Halve one plane’s Turnaround.', 'READY', 150, 200, 8),
    ])
    toasts = ''.join(
        f'<div style="background: {CREAM}; border: 3px solid {INK}; border-radius: 12px; padding: 8px 12px; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 0 {INK}; font-weight: 700; font-size: 13px; color: {c}">{icon(i, 18, c)}<span>{t}</span></div>'
        for i, t, c in [('coin', '+1,800 · B747-8F departed', TEAL), ('fuel', 'Dash 8 low on fuel', CORAL), ('land', 'A320 landed · 97/150', INK)])
    root = (f'<div style="width: {W}px; height: {H}px; position: relative; overflow: hidden; background: {WATER}; {C_FONT}; color: {INK}">'
            f'<svg width="{W}" height="{H}" style="position: absolute; inset: 0" aria-hidden="true">{water_dots(W, H)}</svg>'
            + island(ox, oy, mw, mh)
            + bubble(ox + 700, oy + 56, 'HOLDING · 38 MIN', INK)
            + bubble(ox + 20, oy + 470, 'FINAL · R1', TEAL)
            + bubble(ox + 230, oy + 300, 'LOW FUEL · 9', CORAL)
            + f'<div style="position: absolute; left: 50%; top: 18px; transform: translateX(-50%); background: {CREAM}; border: 3px solid {INK}; border-radius: 999px; padding: 6px 22px 6px 8px; display: flex; align-items: center; gap: 18px; box-shadow: 0 5px 0 {INK}">'
            + f'<div style="position: relative; width: 64px; height: 64px">{ring(0.64)}<span style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; {C_PIX}; font-size: 12px">96</span></div>'
            + f'<div style="display: flex; flex-direction: column"><span style="{C_PIX}; font-size: 26px; line-height: 1">14:37</span><span style="font-size: 12px; color: {MUTE}; font-weight: 700">Sat · Rush Day · Quota 150</span></div>'
            + f'<div style="width: 2px; height: 40px; background: #e7e0d2"></div>'
            + f'<div style="display: flex; align-items: center; gap: 6px; {C_PIX}; font-size: 18px">{icon("coin", 22, CORAL)}184,250</div>'
            + '</div>'
            + f'<div style="position: absolute; left: 20px; top: 20px; background: {CREAM}; border: 3px solid {INK}; border-radius: 14px; padding: 8px 14px; box-shadow: 0 4px 0 {INK}; display: flex; flex-direction: column; gap: 2px">'
            + f'<span style="{C_PIX}; font-size: 14px">Week 2</span><span style="font-size: 12px; color: {MUTE}; font-weight: 700">Boss tomorrow: Heavy Rain</span></div>'
            + f'<div style="position: absolute; right: 20px; top: 20px; display: flex; flex-direction: column; gap: 10px; align-items: flex-end">{toasts}</div>'
            + f'<div style="position: absolute; left: 50%; bottom: -40px; transform: translateX(-50%); display: flex; gap: 14px; align-items: flex-end">{hand}</div>'
            + f'<div style="position: absolute; right: 24px; bottom: 24px; display: flex; gap: 8px">'
            + ''.join(f'<button type="button" aria-label="{a}" style="width: 56px; height: 56px; border-radius: 50%; border: 3px solid {INK}; background: {SUN if on else CREAM}; color: {INK}; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 0 {INK}">{icon(i, 24, INK)}</button>'
                      for i, a, on in [('pause', 'Pause', False), ('play', 'Normal speed', True), ('ff', 'Fast forward', False)])
            + '</div>'
            + f'<div style="position: absolute; left: 24px; bottom: 24px; background: {CREAM}; border: 3px solid {INK}; border-radius: 14px; padding: 8px 12px; box-shadow: 0 4px 0 {INK}; display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 13px">{icon("gauge", 20, SUN)}Risk: Medium</div>'
            + '</div>')
    return page('Diorama Deck · Live Day', C_F, CSS, root)


def C_plan():
    # calendar as a board-game track
    tiles = []
    states = ['ok'] * 14 + ['next'] + [''] * 3 + ['tw'] + [''] + ['boss'] + ['lock'] * 7
    labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] * 4
    for i in range(28):
        st = states[i]
        wk, d = divmod(i, 7)
        boss = d == 6
        bg = {'ok': '#d9f2e4', 'next': SUN, 'tw': '#ffe6dc', 'boss': '#ffd3c9', '': CREAM, 'lock': '#e3dccf'}[st]
        if boss and st == 'lock':
            bg = '#e3dccf'
        inner = (icon('check', 18, TEAL) if st == 'ok' else icon('storm', 20, CORAL) if st == 'boss' else
                 icon('plane', 18, INK) if st == 'next' else ('' if st == 'lock' else f'<span style="{C_PIX}; font-size: 11px; color: {MUTE}">Q{105 + (d * 5)}</span>'))
        if boss and st == 'ok':
            inner = icon('check', 18, TEAL)
        tiles.append(f'<div style="height: {64 if boss else 52}px; border-radius: 12px; border: 3px solid {INK if st != "lock" else "#c9c0b0"}; background: {bg}; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; box-shadow: 0 3px 0 {INK if st != "lock" else "#c9c0b0"}">'
                     f'<span style="font-size: 11px; font-weight: 800; color: {MUTE}">{labels[i]}{" · BOSS" if boss else ""}</span>{inner}</div>')
    track = ''
    for wk in range(4):
        row = tiles[wk * 7:(wk + 1) * 7]
        track += (f'<div style="display: flex; align-items: center; gap: 8px"><span style="{C_PIX}; font-size: 12px; width: 32px; color: {MUTE}">W{wk + 1}</span>'
                  f'<div style="flex: 1; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; align-items: center">{"".join(row)}</div></div>')
    shop = ''.join([
        card(icon('runway', 44, CORAL), 'ILS for R1', 'Lands in storms. Pilot Error −40%.', '80,000 · +500/day', 176, 236, 0, hl=True),
        card(icon('runway', 44, INK), '2nd Runway', 'Medium Asphalt. Needs 8 space.', '100,000 · +1,700/day', 176, 236, 0),
        card(icon('stand', 44, INK), 'Large Stand #3', '+6 Large flights per Day.', '56,300 · +250/day', 176, 236, 0),
        card(icon('bay', 44, INK), 'Large Holding Bay', 'Land now, park later.', '16,000 · +80/day', 176, 236, 0),
        card(icon('tower', 44, INK), 'Radar 3', 'Unlocks Fuel + Emergency Alerts.', '24,000 · +200/day', 176, 236, 0),
        card(icon('fire', 44, INK), 'Fire & Rescue 2', 'Crash blockage 45 → 33 min.', '12,000 · +300/day', 176, 236, 0),
    ])
    root = (f'<div style="width: {W}px; height: {H}px; position: relative; overflow: hidden; background: {WATER}; {C_FONT}; color: {INK}">'
            f'<svg width="{W}" height="{H}" style="position: absolute; inset: 0" aria-hidden="true">{water_dots(W, H, 60, 9)}</svg>'
            + f'<div style="position: absolute; left: 24px; top: 24px; width: 820px; background: {CREAM}; border: 3px solid {INK}; border-radius: 20px; padding: 16px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 6px 0 {INK}">'
            + f'<div style="display: flex; justify-content: space-between; align-items: center"><span style="{C_PIX}; font-size: 20px">Run Calendar</span><span style="font-size: 13px; font-weight: 700; color: {CORAL}">Sunday Boss: Storm · needs ILS</span></div>'
            + track + '</div>'
            + island(880, 40, 520, 316, grid_overlay('rgba(59,51,85,0.15)'))
            + f'<div style="position: absolute; left: 880px; top: 420px; width: 520px; background: {CREAM}; border: 3px solid {INK}; border-radius: 16px; padding: 12px 16px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; box-shadow: 0 5px 0 {INK}">'
            + ''.join(f'<div style="display: flex; flex-direction: column"><span style="font-size: 11px; font-weight: 800; color: {MUTE}">{k}</span><span style="{C_PIX}; font-size: 15px">{v}</span></div>'
                      for k, v in [('MONEY', '146,670'), ('UPKEEP', '8,180/day'), ('SPACE', '41 / 48'), ('MON QUOTA', '105'), ('COMING', '28S 31M 11L'), ('TURNED AWAY', '0')])
            + '</div>'
            + f'<div style="position: absolute; left: 24px; top: 516px; {C_PIX}; font-size: 16px">Build · drag a card onto the island</div>'
            + f'<div style="position: absolute; left: 24px; top: 552px; display: flex; gap: 14px">{shop}</div>'
            + f'<button type="button" style="position: absolute; right: 40px; bottom: 36px; height: 64px; padding: 0 28px; border-radius: 999px; border: 3px solid {INK}; background: {SUN}; color: {INK}; {C_PIX}; font-size: 18px; display: flex; align-items: center; gap: 10px; box-shadow: 0 6px 0 {INK}">{icon("play", 22, INK)}Start Monday</button>'
            + '</div>')
    return page('Diorama Deck · Plan Mode', C_F, CSS, root)
