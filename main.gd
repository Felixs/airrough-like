extends Node2D
## Airport Auto-Battler, milestone 2: free building on the grid.
## Planes land, park and take off on their own over whatever runways, taxiways and
## stands you build. World units are tiles; TILE converts to pixels.

const TILE := 16.0
const ORIGIN := Vector2(260, 40)
const HOLD_FIX := Vector2(-10, 4)
const HOLD_RADIUS := 3.5

const START_MONEY := 10000
const MAX_FUEL := 90.0
const MAX_CRASHES := 3
const EMERGENCY_FUEL := 20.0
const APPROACH_SPEED := 6.0
const TAXI_SPEED := 2.5
const PUSHBACK_SPEED := 1.0
const TAKEOFF_TOP_SPEED := 9.0
const REFUND := 0.5
const JAM_TIMEOUT := 6.0     # a plane blocked this long squeezes past (gridlock crashes come later)

const L := preload("res://airport_layout.gd")
const A := preload("res://aircraft.gd")
const S := A.State

enum Tool { NONE, TAXIWAY, SHORT_RUNWAY, LONG_RUNWAY, MEDIUM_STAND, LARGE_STAND, BULLDOZE }
const TOOL_KIND := {
	Tool.TAXIWAY: L.Kind.TAXIWAY, Tool.SHORT_RUNWAY: L.Kind.SHORT_RUNWAY, Tool.LONG_RUNWAY: L.Kind.LONG_RUNWAY,
	Tool.MEDIUM_STAND: L.Kind.MEDIUM_STAND, Tool.LARGE_STAND: L.Kind.LARGE_STAND,
}

const PLANE_SHAPE := [
	Vector2(1, 0), Vector2(0.3, 0.15), Vector2(0.1, 0.9), Vector2(-0.1, 0.9), Vector2(-0.1, 0.15),
	Vector2(-0.7, 0.12), Vector2(-0.8, 0.45), Vector2(-0.95, 0.45), Vector2(-0.9, 0),
	Vector2(-0.95, -0.45), Vector2(-0.8, -0.45), Vector2(-0.7, -0.12), Vector2(-0.1, -0.15),
	Vector2(-0.1, -0.9), Vector2(0.1, -0.9), Vector2(0.3, -0.15),
]

var layout := AirportLayout.new()
var planes: Array[Aircraft] = []
var money := START_MONEY
var crashes := 0
var handled := 0
var elapsed := 0.0
var rate := 4.0                # arrivals per minute, set by the slider
var spawn_timer := 2.0
var sim_speed := 1.0
var next_id := 1
var game_over := false
var crash_marks: Array[Dictionary] = []
var popups: Array[Dictionary] = []

var tool := Tool.NONE
var tool_dir := 0
var dragging := false
var last_drag := Vector2i(-999, -999)
var hover := Vector2i(-1, -1)

# UI
var lbl_stats: Label
var lbl_rate: Label
var lbl_msg: Label
var tool_buttons := {}
var overlay: Control
var lbl_over: Label


func _ready() -> void:
	randomize()
	_build_start_airport()
	_build_ui()
	var args := OS.get_cmdline_user_args()
	if "--selftest" in args:
		_selftest(args)
	for a in args:
		if a.begins_with("--shot="):
			_screenshot(a.substr(7), args)


## Every run starts from the same minimal airport.
func _build_start_airport() -> void:
	layout.place(L.Kind.SHORT_RUNWAY, Vector2i(4, 9), 0, 0.0)
	layout.place(L.Kind.TAXIWAY, Vector2i(4, 10), 0, 0.0)     # hold-short at the runway start
	layout.place(L.Kind.TAXIWAY, Vector2i(18, 10), 0, 0.0)    # exit
	for x in range(4, 23):
		layout.place(L.Kind.TAXIWAY, Vector2i(x, 11), 0, 0.0)
	for x in [6, 9, 12, 15]:
		layout.place(L.Kind.MEDIUM_STAND, Vector2i(x, 12), 0, 0.0)
	layout.place(L.Kind.TERMINAL, Vector2i(5, 14), 0, 0.0, Vector2i(13, 2))
	layout.rebuild(0.0)


# ---------------------------------------------------------------- simulation

func _process(delta: float) -> void:
	if not game_over and sim_speed > 0.0:
		var remaining := delta * sim_speed
		while remaining > 0.0 and not game_over:
			var dt: float = min(remaining, 1.0 / 60.0)
			_step(dt)
			remaining -= dt
	var m := (get_local_mouse_position() - ORIGIN) / TILE
	hover = Vector2i(floori(m.x), floori(m.y))
	_update_ui()
	queue_redraw()


func _step(dt: float) -> void:
	var before := elapsed
	elapsed += dt
	for p in layout.pieces.values():
		if p.ready_at > before and p.ready_at <= elapsed:
			layout.dirty = true
	if layout.dirty:
		layout.rebuild(elapsed)

	spawn_timer -= dt
	if spawn_timer <= 0.0:
		_spawn()
		spawn_timer = 60.0 / rate * randf_range(0.7, 1.3)

	_tower()

	for p in planes:
		_update_plane(p, dt)
		if game_over:
			return
	planes = planes.filter(func(p): return p.state != S.GONE)

	for m in crash_marks:
		m.t -= dt
	crash_marks = crash_marks.filter(func(m): return m.t > 0.0)
	for m in popups:
		m.t -= dt
	popups = popups.filter(func(m): return m.t > 0.0)


## Biggest plane the airport can currently take: needs a working runway and a stand that fit it.
func _max_serviceable_size() -> int:
	var rw_max := -1
	for rw in layout.runways(elapsed):
		if layout.runway_problem(rw, elapsed) == "":
			rw_max = max(rw_max, L.runway_max_size(rw))
	var st_max := -1
	for s in layout.stands(elapsed):
		st_max = max(st_max, L.stand_max_size(s))
	return min(rw_max, st_max)


func _spawn() -> void:
	var p := Aircraft.new()
	p.id = next_id
	next_id += 1
	p.fuel = MAX_FUEL
	var top := _max_serviceable_size()
	var r := randf()
	if top >= A.Size.HEAVY and r < 0.2:
		p.size = A.Size.HEAVY
	elif r < 0.55:
		p.size = A.Size.MEDIUM
	else:
		p.size = A.Size.SMALL
	p.hold_angle = randf() * TAU
	p.pos = HOLD_FIX + Vector2.from_angle(p.hold_angle) * HOLD_RADIUS
	planes.append(p)


## For one runway, finds where a plane of each size would exit and which free stand it would taxi to.
func _arrival_options(rw: Dictionary) -> Dictionary:
	var out := {}
	var stands := layout.stands(elapsed)
	stands.sort_custom(func(a, b): return L.stand_max_size(a) < L.stand_max_size(b))
	for size in [A.Size.SMALL, A.Size.MEDIUM, A.Size.HEAVY]:
		if size > L.runway_max_size(rw):
			continue
		var ex := layout.runway_exit(rw, size, elapsed)
		if ex.is_empty():
			continue
		for s in stands:
			if s.user != null or L.stand_max_size(s) < size:
				continue
			var acc := layout.stand_access(s, elapsed)
			if acc.x < 0:
				continue
			var route := layout.taxi_path(ex.taxi, acc)
			if route.is_empty():
				continue
			out[size] = {"exit": ex, "stand": s, "route": route}
			break
	return out


## Each runway serves one plane at a time. Departures go first (they free stands) unless an
## arrival is about to run out of fuel; after an emergency landing a waiting departure goes next.
func _tower() -> void:
	var holding := planes.filter(func(p): return p.state == S.HOLDING)
	for rw in layout.runways(elapsed):
		if rw.user != null:
			continue
		var options := {} if holding.is_empty() else _arrival_options(rw)
		var best: Aircraft = null
		for p in holding:
			if p.state == S.HOLDING and options.has(p.size) and (best == null or p.fuel < best.fuel):
				best = p
		var emergency := best != null and best.fuel < EMERGENCY_FUEL
		if emergency and not (rw.last_emergency and not rw.queue.is_empty()):
			_grant_arrival(best, rw, options[best.size])
			rw.last_emergency = true
		elif not rw.queue.is_empty():
			_grant_departure(rw.queue.pop_front(), rw)
			rw.last_emergency = false
		elif best != null:
			_grant_arrival(best, rw, options[best.size])
			rw.last_emergency = false


func _grant_arrival(p: Aircraft, rw: Dictionary, opt: Dictionary) -> void:
	rw.user = p
	opt.stand.user = p
	p.runway_id = rw.id
	p.stand_id = opt.stand.id
	p.runway_index = opt.exit.index
	p.ground = opt.route
	var d := Vector2(L.DIRS[rw.dir])
	var threshold := L.center(rw.cells[0]) - d * 0.5
	p.set_path(S.APPROACH, [threshold - d * 8.0, threshold], APPROACH_SPEED)


func _grant_departure(p: Aircraft, rw: Dictionary) -> void:
	rw.user = p
	var d := Vector2(L.DIRS[rw.dir])
	var last := L.center(rw.cells[-1])
	p.set_path(S.TAKEOFF, [L.center(rw.cells[p.runway_index]), last, last + d * 14.0], 1.0)


## After turnaround: picks the closest working runway the plane can reach and frees the stand.
func _try_depart(p: Aircraft) -> void:
	var stand: Dictionary = layout.pieces[p.stand_id]
	var acc := layout.stand_access(stand, elapsed)
	var best := {}
	if acc.x >= 0:
		for rw in layout.runways(elapsed):
			if L.runway_max_size(rw) < p.size:
				continue
			var hold := layout.runway_hold(rw, elapsed)
			if hold.is_empty():
				continue
			var route := layout.taxi_path(acc, hold.taxi)
			if not route.is_empty() and (best.is_empty() or route.size() < best.route.size()):
				best = {"rw": rw, "hold": hold, "route": route}
	if best.is_empty():
		p.retry_timer = 1.0
		lbl_msg.text = "A %s plane can't reach a runway it can use!" % A.NAMES[p.size].to_lower()
		return
	stand.user = null
	p.stand_id = -1
	p.runway_id = best.rw.id
	p.runway_index = best.hold.index
	p.ground = best.route
	p.set_path(S.PUSHBACK, [L.center(acc)], PUSHBACK_SPEED, true)


func _update_plane(p: Aircraft, dt: float) -> void:
	match p.state:
		S.HOLDING:
			p.hold_angle += 0.45 * dt
			p.pos = HOLD_FIX + Vector2.from_angle(p.hold_angle) * HOLD_RADIUS
			p.heading = p.hold_angle + PI / 2.0
			p.fuel -= dt
			if p.fuel <= 0.0:
				_crash(p, "%s plane ran out of fuel" % A.NAMES[p.size])

		S.APPROACH:
			if p.advance(dt):
				var rw: Dictionary = layout.pieces[p.runway_id]
				var target := L.center(rw.cells[p.runway_index])
				p.decel = (APPROACH_SPEED ** 2 - TAXI_SPEED ** 2) / (2.0 * max(1.0, p.pos.distance_to(target)))
				p.set_path(S.LANDING, [target], APPROACH_SPEED)

		S.LANDING:
			p.speed = max(TAXI_SPEED, p.speed - p.decel * dt)
			if p.advance(dt):
				var stand: Dictionary = layout.pieces[p.stand_id]
				var pts := _centers(p.ground)
				pts.append(L.stand_center(stand))
				p.set_path(S.TAXI_IN, pts, TAXI_SPEED)

		S.TAXI_IN:
			if p.runway_id >= 0 and p.path_i >= 1:
				layout.pieces[p.runway_id].user = null
				p.runway_id = -1
			if _taxi(p, dt):
				p.state = S.AT_STAND
				p.timer = A.TURNAROUND[p.size]
				p.ground = [p.ground[-1]]

		S.AT_STAND:
			p.timer -= dt
			p.retry_timer -= dt
			if p.timer <= 0.0 and not p.paid:
				p.paid = true
				var fee: int = A.FEE[p.size]
				money += fee
				handled += 1
				popups.append({"pos": p.pos, "text": "+$%d" % fee, "t": 1.5})
			if p.paid and p.retry_timer <= 0.0:
				_try_depart(p)

		S.PUSHBACK:
			if _taxi(p, dt):
				p.set_path(S.TAXI_OUT, _centers(p.ground), TAXI_SPEED)

		S.TAXI_OUT:
			if _taxi(p, dt):
				p.state = S.HOLD_SHORT
				layout.pieces[p.runway_id].queue.append(p)

		S.TAKEOFF:
			p.speed = min(TAKEOFF_TOP_SPEED, p.speed + 3.0 * dt)
			var done := p.advance(dt)
			if p.runway_id >= 0 and p.path_i >= 2:
				layout.pieces[p.runway_id].user = null
				p.runway_id = -1
			if done:
				p.state = S.GONE


func _centers(cells: Array) -> Array:
	return cells.map(func(c): return L.center(c))


## Moves along the taxi route unless another plane on the ground is too close ahead.
func _taxi(p: Aircraft, dt: float) -> bool:
	if p.ghost_time > 0.0:
		p.ghost_time -= dt
		p.blocked_by = null
	else:
		p.blocked_by = _blocker(p)
	if p.blocked_by != null:
		p.blocked_time += dt
		if p.blocked_time > JAM_TIMEOUT:
			p.ghost_time = 1.5
			p.blocked_time = 0.0
		return false
	p.blocked_time = 0.0
	return p.advance(dt)


func _blocker(p: Aircraft) -> Aircraft:
	var dir := p.move_dir()
	if dir == Vector2.ZERO:
		return null
	for o in planes:
		if o == p or not (o.state in A.GROUND_STATES):
			continue
		var rel := o.pos - p.pos
		var along := rel.dot(dir)
		if along <= 0.05 or abs(rel.cross(dir)) > 0.8:
			continue
		if along < A.RADIUS[p.size] + A.RADIUS[o.size] + 0.4:
			if o.blocked_by == p and p.id < o.id:
				continue
			return o
	return null


func _crash(p: Aircraft, why: String) -> void:
	crashes += 1
	crash_marks.append({"pos": p.pos, "t": 4.0})
	p.state = S.GONE
	lbl_msg.text = "CRASH %d/%d: %s!" % [crashes, MAX_CRASHES, why]
	if crashes >= MAX_CRASHES:
		game_over = true
		lbl_over.text = "RUN OVER\n\nSurvived %s\nPlanes handled: %d\nMoney: $%s" % [_fmt_time(elapsed), handled, _fmt_money(money)]
		overlay.visible = true


# ---------------------------------------------------------------- building

func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventKey and e.pressed and not e.echo:
		match e.keycode:
			KEY_R:
				tool_dir = (tool_dir + 1) % 4
			KEY_ESCAPE:
				_set_tool(Tool.NONE)
			KEY_SPACE:
				sim_speed = 1.0 if sim_speed == 0.0 else 0.0
	elif e is InputEventMouseButton:
		if e.button_index == MOUSE_BUTTON_RIGHT and e.pressed:
			_set_tool(Tool.NONE)
		elif e.button_index == MOUSE_BUTTON_LEFT:
			dragging = e.pressed
			if e.pressed and not game_over:
				last_drag = hover
				_apply_tool(hover)
	elif e is InputEventMouseMotion and dragging and not game_over:
		if tool == Tool.TAXIWAY or tool == Tool.BULLDOZE:
			var m := (get_local_mouse_position() - ORIGIN) / TILE
			var t := Vector2i(floori(m.x), floori(m.y))
			# Fill every tile between the last one and this one so fast drags leave no gaps.
			while last_drag != t:
				var d := t - last_drag
				if abs(d.x) >= abs(d.y):
					last_drag.x += signi(d.x)
				else:
					last_drag.y += signi(d.y)
				_apply_tool(last_drag)


func _set_tool(t: int) -> void:
	tool = t
	for k in tool_buttons:
		tool_buttons[k].set_pressed_no_signal(k == t)


func _apply_tool(c: Vector2i) -> void:
	if tool == Tool.NONE or not L.inside(c):
		return
	if tool == Tool.BULLDOZE:
		_bulldoze(c)
		return
	var kind: int = TOOL_KIND[tool]
	var reason := layout.can_place(kind, c, tool_dir)
	if reason != "":
		if tool != Tool.TAXIWAY or not dragging:
			lbl_msg.text = reason + "."
		return
	var cost: int = L.COST[kind]
	if money < cost:
		lbl_msg.text = "Not enough money for a %s." % L.NAMES[kind].to_lower()
		return
	money -= cost
	layout.place(kind, c, tool_dir, elapsed + L.BUILD_TIME[kind])
	if kind != L.Kind.TAXIWAY:
		lbl_msg.text = "Building a %s ($%s)." % [L.NAMES[kind].to_lower(), _fmt_money(cost)]


func _bulldoze(c: Vector2i) -> void:
	var piece := layout.piece_at(c)
	if piece.is_empty():
		return
	if piece.kind == L.Kind.TERMINAL:
		lbl_msg.text = "The terminal can't be removed."
		return
	if _in_use(piece):
		lbl_msg.text = "%s is in use right now." % L.NAMES[piece.kind]
		return
	var refund := int(piece.cost * REFUND)
	money += refund
	layout.remove(piece.id)
	if piece.kind != L.Kind.TAXIWAY:
		lbl_msg.text = "Removed a %s (+$%s)." % [L.NAMES[piece.kind].to_lower(), _fmt_money(refund)]


## A piece that a plane is using or about to use can't be removed.
func _in_use(piece: Dictionary) -> bool:
	if piece.user != null:
		return true
	for p in planes:
		if p.state == S.HOLDING:
			continue
		if p.runway_id == piece.id or p.stand_id == piece.id:
			return true
		for c in piece.cells:
			if p.ground.has(c):
				return true
	return false


# ---------------------------------------------------------------- UI

func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)

	var panel := PanelContainer.new()
	panel.position = Vector2(1066, 8)
	panel.custom_minimum_size = Vector2(206, 0)
	layer.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	panel.add_child(box)

	var title := Label.new()
	title.text = "Airport Auto-Battler"
	box.add_child(title)
	lbl_stats = Label.new()
	box.add_child(lbl_stats)

	box.add_child(HSeparator.new())
	lbl_rate = Label.new()
	box.add_child(lbl_rate)
	var slider := HSlider.new()
	slider.min_value = 1
	slider.max_value = 30
	slider.step = 1
	slider.value = rate
	slider.focus_mode = Control.FOCUS_NONE
	slider.value_changed.connect(func(v): rate = v; spawn_timer = min(spawn_timer, 60.0 / rate))
	box.add_child(slider)

	box.add_child(HSeparator.new())
	var build_title := Label.new()
	build_title.text = "Build"
	box.add_child(build_title)
	for entry in [
		[Tool.TAXIWAY, "Taxiway  $150/tile"],
		[Tool.SHORT_RUNWAY, "Short runway  $8,000"],
		[Tool.LONG_RUNWAY, "Long runway  $20,000"],
		[Tool.MEDIUM_STAND, "Medium stand  $3,000"],
		[Tool.LARGE_STAND, "Large stand  $7,000"],
		[Tool.BULLDOZE, "Bulldoze  (50% back)"],
	]:
		var b := Button.new()
		b.text = entry[1]
		b.toggle_mode = true
		b.focus_mode = Control.FOCUS_NONE
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		var t: int = entry[0]
		b.toggled.connect(func(on): _set_tool(t if on else Tool.NONE))
		tool_buttons[t] = b
		box.add_child(b)
	var hint := Label.new()
	hint.add_theme_font_size_override("font_size", 12)
	hint.text = "Drag: paint taxiways\nR: rotate runway\nRight-click / Esc: stop building\nSpace: pause"
	box.add_child(hint)

	box.add_child(HSeparator.new())
	var speeds := HBoxContainer.new()
	box.add_child(speeds)
	for s in [["||", 0.0], ["1x", 1.0], ["2x", 2.0], ["3x", 3.0]]:
		var b := Button.new()
		b.text = s[0]
		b.focus_mode = Control.FOCUS_NONE
		var v: float = s[1]
		b.pressed.connect(func(): sim_speed = v)
		speeds.add_child(b)

	lbl_msg = Label.new()
	lbl_msg.autowrap_mode = TextServer.AUTOWRAP_WORD
	lbl_msg.custom_minimum_size = Vector2(190, 54)
	lbl_msg.text = "Planes fly in on their own. Expand the airport and set how many arrive per minute. 3 crashes end the run."
	box.add_child(lbl_msg)

	var legend := Label.new()
	legend.add_theme_font_size_override("font_size", 12)
	legend.text = "Yellow: small (Cessna)\nBlue: medium (A321)\nOrange: heavy (A380)\nRing = fuel left"
	box.add_child(legend)

	overlay = ColorRect.new()
	overlay.color = Color(0, 0, 0, 0.6)
	overlay.position = Vector2.ZERO
	overlay.size = Vector2(1280, 880)
	overlay.visible = false
	layer.add_child(overlay)
	var center := VBoxContainer.new()
	center.position = Vector2(520, 320)
	center.custom_minimum_size = Vector2(240, 0)
	overlay.add_child(center)
	lbl_over = Label.new()
	lbl_over.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lbl_over.add_theme_font_size_override("font_size", 22)
	center.add_child(lbl_over)
	var restart := Button.new()
	restart.text = "Start a new run"
	restart.pressed.connect(func(): get_tree().reload_current_scene())
	center.add_child(restart)


func _update_ui() -> void:
	var holding := planes.filter(func(p): return p.state == S.HOLDING).size()
	lbl_stats.text = "Money: $%s\nCrashes: %d / %d\nHandled: %d\nHolding: %d\nTime: %s" % [
		_fmt_money(money), crashes, MAX_CRASHES, handled, holding, _fmt_time(elapsed)]
	lbl_rate.text = "Arrivals per minute: %d" % int(rate)
	for k in tool_buttons:
		if k != Tool.BULLDOZE:
			tool_buttons[k].disabled = money < L.COST[TOOL_KIND[k]]


func _fmt_money(v: int) -> String:
	var s := str(abs(v))
	var out := ""
	while s.length() > 3:
		out = "," + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return ("-" if v < 0 else "") + s + out


func _fmt_time(t: float) -> String:
	return "%d:%02d" % [int(t) / 60, int(t) % 60]


# ---------------------------------------------------------------- drawing

func _t(v: Vector2) -> Vector2:
	return ORIGIN + v * TILE


func _cell_rect(c: Vector2i, inset := 0.0) -> Rect2:
	return Rect2(_t(Vector2(c) + Vector2(inset, inset)), Vector2.ONE * TILE * (1.0 - 2.0 * inset))


func _draw() -> void:
	var font := ThemeDB.fallback_font
	var field := Rect2(ORIGIN, Vector2(L.W, L.H) * TILE)
	draw_rect(field, Color(0.24, 0.42, 0.24))
	draw_rect(field, Color(0.9, 0.9, 0.9, 0.35), false, 2.0)
	draw_string(font, _t(Vector2(0.5, L.H - 0.6)), "Starting airfield 50 x 50", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(1, 1, 1, 0.5))

	var pieces: Array = layout.pieces.values()
	for p in pieces:
		if p.kind == L.Kind.TAXIWAY:
			_draw_taxiway(p)
	_draw_taxi_lines()
	for p in pieces:
		if L.is_runway(p.kind):
			_draw_runway(p, font)
		elif L.is_stand(p.kind):
			_draw_stand(p, font)
		elif p.kind == L.Kind.TERMINAL:
			var r := Rect2(_t(Vector2(p.origin)), Vector2(13, 2) * TILE)
			draw_rect(r, Color(0.7, 0.72, 0.75))
			draw_string(font, r.position + Vector2(8, 21), "Terminal", HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(0.15, 0.15, 0.15))

	draw_arc(_t(HOLD_FIX), HOLD_RADIUS * TILE, 0, TAU, 48, Color(1, 1, 1, 0.15), 1.0)
	draw_string(font, _t(HOLD_FIX + Vector2(-2.2, 0.3)), "Holding", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(1, 1, 1, 0.5))

	for p in planes:
		_draw_plane(p)
	for p in planes:
		if p.state == S.AT_STAND:
			var frac: float = 1.0 - max(p.timer, 0.0) / A.TURNAROUND[p.size]
			var base := _t(p.pos + Vector2(-1.0, 1.2))
			draw_rect(Rect2(base, Vector2(2.0 * TILE, 3)), Color(0, 0, 0, 0.5))
			draw_rect(Rect2(base, Vector2(2.0 * TILE * frac, 3)), Color(0.4, 0.9, 1.0) if not p.paid else Color(1, 0.8, 0.2))

	for m in crash_marks:
		var c := _t(m.pos)
		var a: float = clamp(m.t / 4.0, 0.0, 1.0)
		draw_circle(c, 14.0 * (2.0 - a), Color(1, 0.4, 0.1, 0.5 * a))
		draw_line(c + Vector2(-8, -8), c + Vector2(8, 8), Color(1, 0.1, 0.1, a), 3.0)
		draw_line(c + Vector2(-8, 8), c + Vector2(8, -8), Color(1, 0.1, 0.1, a), 3.0)
	for m in popups:
		var y: float = (1.5 - m.t) * 12.0
		draw_string(font, _t(m.pos) + Vector2(-14, -18 - y), m.text, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(0.5, 1, 0.5, m.t / 1.5))

	_draw_ghost(font)


func _build_alpha(p: Dictionary) -> float:
	return 1.0 if layout.is_ready(p, elapsed) else 0.4


func _build_progress(p: Dictionary) -> float:
	var total: float = L.BUILD_TIME[p.kind]
	return 1.0 if total <= 0.0 else clamp(1.0 - (p.ready_at - elapsed) / total, 0.0, 1.0)


func _draw_taxiway(p: Dictionary) -> void:
	draw_rect(_cell_rect(p.origin), Color(0.33, 0.33, 0.35, _build_alpha(p)))


func _draw_taxi_lines() -> void:
	var col := Color(0.95, 0.8, 0.15, 0.8)
	for p in layout.pieces.values():
		if p.kind != L.Kind.TAXIWAY or not layout.is_ready(p, elapsed):
			continue
		var c: Vector2i = p.origin
		for d in [Vector2i(1, 0), Vector2i(0, 1)]:
			var n: Vector2i = c + d
			if layout.tile(n) == L.Tile.TAXIWAY and layout.is_ready(layout.piece_at(n), elapsed):
				draw_line(_t(L.center(c)), _t(L.center(n)), col, 1.0)


func _draw_runway(p: Dictionary, font: Font) -> void:
	var a := _build_alpha(p)
	var cells: Array = p.cells
	var d := Vector2(L.DIRS[p.dir])
	var side := Vector2(-d.y, d.x)
	var start := L.center(cells[0]) - d * 0.5
	var finish := L.center(cells[-1]) + d * 0.5
	var half := 0.75
	var poly := PackedVector2Array([
		_t(start + side * half), _t(finish + side * half), _t(finish - side * half), _t(start - side * half)])
	draw_colored_polygon(poly, Color(0.2, 0.2, 0.22, a))
	# centreline dashes
	for i in range(2, cells.size() - 1, 2):
		var c := L.center(cells[i])
		draw_line(_t(c - d * 0.5), _t(c + d * 0.5), Color(0.95, 0.95, 0.95, a), 2.0)
	# threshold bars and a direction chevron at the landing end
	for k in [-0.5, -0.25, 0.0, 0.25, 0.5]:
		var o: Vector2 = start + d * 0.3 + side * k
		draw_line(_t(o), _t(o + d * 0.8), Color(1, 1, 1, a), 2.0)
	var tip := start + d * 2.6
	draw_polyline(PackedVector2Array([_t(tip - d * 0.5 + side * 0.45), _t(tip), _t(tip - d * 0.5 - side * 0.45)]), Color(1, 1, 1, a), 2.0)
	var label_pos := _t(start - side * 1.6) + Vector2(0, 4)
	if not layout.is_ready(p, elapsed):
		draw_string(font, label_pos, "building %d%%" % int(_build_progress(p) * 100), HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(1, 1, 1, 0.8))
		return
	var problem := layout.runway_problem(p, elapsed)
	var label := "%s, lands %s" % [L.NAMES[p.kind], L.DIR_NAMES[p.dir]]
	if problem != "":
		label = "Runway " + problem
	draw_string(font, label_pos, label, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(1, 0.45, 0.4) if problem != "" else Color(1, 1, 1, 0.7))


func _draw_stand(p: Dictionary, font: Font) -> void:
	var a := _build_alpha(p)
	var n: int = L.STAND_FOOTPRINT[p.kind]
	var r := Rect2(_t(Vector2(p.origin) + Vector2(0.1, 0.1)), Vector2(n - 0.2, n - 0.2) * TILE)
	draw_rect(r, Color(0.3, 0.3, 0.33, a))
	draw_rect(r, Color(0.95, 0.8, 0.1, 0.8 * a), false, 1.0)
	var label := "L" if p.kind == L.Kind.LARGE_STAND else "M"
	if not layout.is_ready(p, elapsed):
		label = "%d%%" % int(_build_progress(p) * 100)
	draw_string(font, r.position + Vector2(3, 11), label, HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Color(1, 1, 1, 0.6))
	if layout.is_ready(p, elapsed) and layout.stand_access(p, elapsed).x < 0:
		draw_string(font, r.position + Vector2(3, r.size.y - 3), "no taxiway", HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Color(1, 0.45, 0.4))


func _draw_ghost(font: Font) -> void:
	if tool == Tool.NONE or not L.inside(hover):
		return
	var mouse := _t(Vector2(hover)) + Vector2(14, -6)
	if tool == Tool.BULLDOZE:
		var piece := layout.piece_at(hover)
		if piece.is_empty():
			draw_rect(_cell_rect(hover), Color(1, 0.3, 0.3, 0.5), false, 1.0)
			return
		for c in piece.cells:
			draw_rect(_cell_rect(c), Color(1, 0.2, 0.2, 0.35))
		var text := "Can't remove" if piece.kind == L.Kind.TERMINAL else "+$%s" % _fmt_money(int(piece.cost * REFUND))
		draw_string(font, mouse, text, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(1, 1, 1))
		return
	var kind: int = TOOL_KIND[tool]
	var reason := layout.can_place(kind, hover, tool_dir)
	var ok: bool = reason == "" and money >= L.COST[kind]
	var col := Color(0.3, 1, 0.4, 0.45) if ok else Color(1, 0.25, 0.25, 0.45)
	for c in L.cells_for(kind, hover, tool_dir):
		draw_rect(_cell_rect(c), col)
	if L.is_runway(kind):
		var d := Vector2(L.DIRS[tool_dir])
		var s := L.center(hover)
		draw_line(_t(s), _t(s + d * 3.0), Color(1, 1, 1), 2.0)
	var text := "$%s" % _fmt_money(L.COST[kind]) if reason == "" else reason
	if reason == "" and money < L.COST[kind]:
		text = "Not enough money"
	draw_string(font, mouse, text, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(1, 1, 1))


func _draw_plane(p: Aircraft) -> void:
	var r: float = A.RADIUS[p.size] * TILE
	var pts := PackedVector2Array()
	for v in PLANE_SHAPE:
		pts.append(_t(p.pos) + (v as Vector2).rotated(p.heading) * r)
	draw_colored_polygon(pts, A.COLOR[p.size])
	if p.state == S.HOLDING:
		var frac: float = clamp(p.fuel / MAX_FUEL, 0.0, 1.0)
		draw_arc(_t(p.pos), r + 5, -PI / 2, -PI / 2 + TAU * frac, 24, Color(1, 0.2, 0.2).lerp(Color(0.3, 1, 0.3), frac), 2.0)


# ---------------------------------------------------------------- testing helpers

## Builds a second, long runway with its own taxiways and a large stand, the way a player would.
## Used by the self-test and the screenshot mode.
func _build_expansion() -> void:
	money += 60000
	var plan := [[L.Kind.LONG_RUNWAY, Vector2i(4, 24), 0]]
	plan.append([L.Kind.TAXIWAY, Vector2i(4, 23), 0])       # hold-short
	plan.append([L.Kind.TAXIWAY, Vector2i(26, 23), 0])      # exit for heavies
	plan.append([L.Kind.TAXIWAY, Vector2i(14, 23), 0])      # exit for small/medium
	for x in range(4, 27):
		plan.append([L.Kind.TAXIWAY, Vector2i(x, 22), 0])
	for y in range(12, 22):
		plan.append([L.Kind.TAXIWAY, Vector2i(22, y), 0])   # links both taxiway systems
	plan.append([L.Kind.LARGE_STAND, Vector2i(23, 13), 0])
	plan.append([L.Kind.MEDIUM_STAND, Vector2i(23, 17), 0])
	plan.append([L.Kind.MEDIUM_STAND, Vector2i(20, 20), 0])
	for step in plan:
		var reason := layout.can_place(step[0], step[1], step[2])
		assert(reason == "", "can't place %s at %s: %s" % [L.NAMES[step[0]], step[1], reason])
		money -= L.COST[step[0]]
		layout.place(step[0], step[1], step[2], elapsed)
	layout.rebuild(elapsed)


## godot --headless --path . -- --selftest rate=4 seconds=600 [expand]
func _selftest(args: PackedStringArray) -> void:
	var seconds := 600.0
	for a in args:
		if a.begins_with("rate="):
			rate = float(a.substr(5))
		elif a.begins_with("seconds="):
			seconds = float(a.substr(8))
	_check_rules()
	if "expand" in args:
		_build_expansion()
	var max_blocked := 0.0
	var sizes := [0, 0, 0]
	var seen := {}
	while elapsed < seconds and not game_over:
		_step(1.0 / 60.0)
		for p in planes:
			max_blocked = max(max_blocked, p.blocked_time)
			if p.state == S.AT_STAND and not seen.has(p.id):
				seen[p.id] = true
				sizes[p.size] += 1
	print("SELFTEST rate=%d time=%s handled=%d crashes=%d money=%d parked(S/M/H)=%s max_blocked=%.1fs game_over=%s" % [
		int(rate), _fmt_time(elapsed), handled, crashes, money, sizes, max_blocked, game_over])
	get_tree().quit()


## Placement rules that must hold.
func _check_rules() -> void:
	var fails := []
	if layout.can_place(L.Kind.TAXIWAY, Vector2i(10, 9), 0) == "":
		fails.append("taxiway on a runway was allowed")
	if layout.can_place(L.Kind.MEDIUM_STAND, Vector2i(40, 40), 0) == "":
		fails.append("stand without a taxiway was allowed")
	if layout.can_place(L.Kind.LONG_RUNWAY, Vector2i(30, 30), 0) == "":
		fails.append("runway sticking out of the field was allowed")
	if layout.can_place(L.Kind.LONG_RUNWAY, Vector2i(45, 2), 1) != "":
		fails.append("valid north-south runway was refused")
	var rw: Dictionary = layout.piece_at(Vector2i(4, 9))
	if layout.runway_problem(rw, 0.0) != "":
		fails.append("starting runway reports a problem")
	if layout.runway_exit(rw, A.Size.MEDIUM, 0.0).get("taxi") != Vector2i(18, 10):
		fails.append("starting runway exit is wrong")
	# A runway with no taxiways must report it.
	var lone := layout.place(L.Kind.SHORT_RUNWAY, Vector2i(10, 40), 0, 0.0)
	if layout.runway_problem(layout.pieces[lone], 0.0) == "":
		fails.append("unconnected runway reports no problem")
	layout.remove(lone)
	layout.rebuild(0.0)
	print("RULES " + ("ok" if fails.is_empty() else "FAILED: " + ", ".join(fails)))


## Plays for a while at high speed, then saves a screenshot (needs a display, e.g. xvfb-run).
## godot --path . -- --shot=out.png [rate=4] [after=90] [expand] [ghost]
func _screenshot(path: String, args: PackedStringArray) -> void:
	var after := 90.0
	for a in args:
		if a.begins_with("rate="):
			rate = float(a.substr(5))
		elif a.begins_with("after="):
			after = float(a.substr(6))
	if "expand" in args:
		_build_expansion()
	while elapsed < after:
		_step(1.0 / 60.0)
	if "ghost" in args:
		# Show a runway being placed and one under construction.
		money += 20000
		layout.place(L.Kind.SHORT_RUNWAY, Vector2i(30, 30), 1, elapsed + 10.0)
		tool = Tool.LONG_RUNWAY
		tool_dir = 0
	sim_speed = 0.0
	_update_ui()
	set_process(false)
	hover = Vector2i(10, 36)
	queue_redraw()
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(path)
	get_tree().quit()
