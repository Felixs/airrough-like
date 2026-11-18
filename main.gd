extends Node2D
## Airport Auto-Battler: core loop prototype (M1).
## Everything is drawn with simple shapes. World units are tiles; TILE converts to pixels.

const TILE := 16.0
const FIELD := 50
const ORIGIN := Vector2(260, 40)

# Layout of the starting airfield (tile coordinates).
const RW_Y := 10.0
const RW_START := 4.0
const RW_END_SHORT := 32.0
const RW_END_LONG := 46.0
const LANE_Y := 13.0
const HOLD_SHORT := Vector2(4, 12)
const EXIT_X := 30.0          # exit for small and medium planes
const HEAVY_EXIT_X := 44.0    # exit at the end of the long runway
const APPROACH_FIX := Vector2(-8, 10)
const HOLD_FIX := Vector2(-10, 3)
const HOLD_RADIUS := 3.5
const TERMINAL := Rect2(6, 18.5, 26, 2.5)

# Tuning (starting values from the design doc).
const START_MONEY := 10000
const MAX_FUEL := 90.0
const MAX_CRASHES := 3
const EMERGENCY_FUEL := 20.0
const APPROACH_SPEED := 6.0
const TAXI_SPEED := 2.5
const PUSHBACK_SPEED := 1.0
const TAKEOFF_TOP_SPEED := 9.0
const STAND_COST := 3000
const LARGE_STAND_COST := 7000
const LONG_RUNWAY_COST := 15000

enum Size { SMALL, MEDIUM, HEAVY }
const SIZE_NAME := ["Small", "Medium", "Heavy"]
const SIZE_R := [0.6, 1.0, 1.5]
const SIZE_FEE := [300, 600, 1200]
const SIZE_TURNAROUND := [10.0, 20.0, 40.0]
const SIZE_COLOR := [Color(0.95, 0.95, 0.6), Color(0.85, 0.92, 1.0), Color(1.0, 0.75, 0.55)]

enum State { HOLDING, APPROACH, LANDING, TAXI_IN, AT_STAND, PUSHBACK, TAXI_OUT, HOLD_SHORT, TAKEOFF, GONE }
const GROUND_STATES := [State.TAXI_IN, State.PUSHBACK, State.TAXI_OUT, State.HOLD_SHORT]

const PLANE_SHAPE := [
	Vector2(1, 0), Vector2(0.3, 0.15), Vector2(0.1, 0.9), Vector2(-0.1, 0.9), Vector2(-0.1, 0.15),
	Vector2(-0.7, 0.12), Vector2(-0.8, 0.45), Vector2(-0.95, 0.45), Vector2(-0.9, 0),
	Vector2(-0.95, -0.45), Vector2(-0.8, -0.45), Vector2(-0.7, -0.12), Vector2(-0.1, -0.15),
	Vector2(-0.1, -0.9), Vector2(0.1, -0.9), Vector2(0.3, -0.15),
]


class Aircraft:
	var id: int
	var size: int
	var state: int = State.HOLDING
	var pos := Vector2.ZERO
	var heading := 0.0
	var path: Array = []
	var path_i := 0
	var speed := 0.0
	var decel := 0.0
	var reverse := false
	var fuel := MAX_FUEL
	var timer := 0.0
	var stand := -1
	var hold_angle := 0.0
	var blocked_by: Aircraft = null
	var blocked_time := 0.0


var planes: Array[Aircraft] = []
var stands: Array[Dictionary] = []
var departure_queue: Array[Aircraft] = []
var runway_user: Aircraft = null
var long_runway := false
var last_was_emergency := false

var money := START_MONEY
var crashes := 0
var handled := 0
var elapsed := 0.0
var rate := 4.0            # arrivals per minute, set by the slider
var spawn_timer := 2.0
var sim_speed := 1.0
var next_id := 1
var game_over := false
var crash_marks: Array[Dictionary] = []
var popups: Array[Dictionary] = []

# UI
var lbl_stats: Label
var lbl_rate: Label
var lbl_msg: Label
var btn_stand: Button
var btn_large: Button
var btn_runway: Button
var overlay: Control
var lbl_over: Label


func _ready() -> void:
	randomize()
	# Stand slots: 4 medium stands are owned from the start, the rest can be bought.
	for x in [8, 12, 16, 20]:
		stands.append({"x": float(x), "size": Size.MEDIUM, "owned": true, "user": null})
	stands.append({"x": 24.0, "size": Size.MEDIUM, "owned": false, "user": null})
	stands.append({"x": 28.0, "size": Size.HEAVY, "owned": false, "user": null})
	_build_ui()

	var args := OS.get_cmdline_user_args()
	if "--selftest" in args:
		_selftest(args)
	for a in args:
		if a.begins_with("--shot="):
			_screenshot(a.substr(7), args)


# ---------------------------------------------------------------- simulation

func _process(delta: float) -> void:
	if not game_over and sim_speed > 0.0:
		# Fixed small steps keep 3x speed stable.
		var remaining := delta * sim_speed
		while remaining > 0.0 and not game_over:
			var dt: float = min(remaining, 1.0 / 60.0)
			_step(dt)
			remaining -= dt
	_update_ui()
	queue_redraw()


func _step(dt: float) -> void:
	elapsed += dt

	spawn_timer -= dt
	if spawn_timer <= 0.0:
		_spawn()
		spawn_timer = 60.0 / rate * randf_range(0.7, 1.3)

	_tower()

	for p in planes:
		_update_plane(p, dt)
		if game_over:
			return
	planes = planes.filter(func(p): return p.state != State.GONE)

	for m in crash_marks:
		m.t -= dt
	crash_marks = crash_marks.filter(func(m): return m.t > 0.0)
	for m in popups:
		m.t -= dt
	popups = popups.filter(func(m): return m.t > 0.0)


func _spawn() -> void:
	var p := Aircraft.new()
	p.id = next_id
	next_id += 1
	var heavy_ok := long_runway and _owns_large_stand()
	var r := randf()
	if heavy_ok and r < 0.2:
		p.size = Size.HEAVY
	elif r < 0.55:
		p.size = Size.MEDIUM
	else:
		p.size = Size.SMALL
	p.hold_angle = randf() * TAU
	p.pos = HOLD_FIX + Vector2.from_angle(p.hold_angle) * HOLD_RADIUS
	planes.append(p)


func _owns_large_stand() -> bool:
	for s in stands:
		if s.owned and s.size == Size.HEAVY:
			return true
	return false


## Picks a free owned stand that fits the plane, preferring the smallest one.
func _free_stand_for(size: int) -> int:
	var best := -1
	for i in stands.size():
		var s: Dictionary = stands[i]
		if s.owned and s.user == null and s.size >= size:
			if best == -1 or s.size < stands[best].size:
				best = i
	return best


## The tower hands out the single runway. Departures go first (they free stands),
## unless an arriving plane is about to run out of fuel. After an emergency landing,
## a waiting departure always goes next so the taxiway can't back up forever.
func _tower() -> void:
	if runway_user != null:
		return
	var best_arrival: Aircraft = null
	var best_stand := -1
	for p in planes:
		if p.state != State.HOLDING:
			continue
		var s := _free_stand_for(p.size)
		if s == -1:
			continue
		if best_arrival == null or p.fuel < best_arrival.fuel:
			best_arrival = p
			best_stand = s
	var emergency := best_arrival != null and best_arrival.fuel < EMERGENCY_FUEL
	if emergency and not (last_was_emergency and not departure_queue.is_empty()):
		_grant_arrival(best_arrival, best_stand)
		last_was_emergency = true
	elif not departure_queue.is_empty():
		_grant_departure(departure_queue.pop_front())
		last_was_emergency = false
	elif best_arrival != null:
		_grant_arrival(best_arrival, best_stand)
		last_was_emergency = false


func _grant_arrival(p: Aircraft, s: int) -> void:
	runway_user = p
	p.stand = s
	stands[s].user = p
	_set_path(p, State.APPROACH, [APPROACH_FIX, Vector2(RW_START, RW_Y)], APPROACH_SPEED)


func _grant_departure(p: Aircraft) -> void:
	runway_user = p
	var rw_end := RW_END_LONG if long_runway else RW_END_SHORT
	_set_path(p, State.TAKEOFF, [Vector2(RW_START, RW_Y), Vector2(rw_end, RW_Y), Vector2(rw_end + 12, RW_Y - 8)], 1.0)


func _set_path(p: Aircraft, state: int, path: Array, speed: float, reverse := false) -> void:
	p.state = state
	p.path = path
	p.path_i = 0
	p.speed = speed
	p.reverse = reverse


func _stand_pos(s: int) -> Vector2:
	var st: Dictionary = stands[s]
	return Vector2(st.x, 16.5 if st.size == Size.HEAVY else 16.0)


func _update_plane(p: Aircraft, dt: float) -> void:
	match p.state:
		State.HOLDING:
			p.hold_angle += 0.45 * dt
			p.pos = HOLD_FIX + Vector2.from_angle(p.hold_angle) * HOLD_RADIUS
			p.heading = p.hold_angle + PI / 2.0
			p.fuel -= dt
			if p.fuel <= 0.0:
				_crash(p, "%s plane ran out of fuel in the holding pattern" % SIZE_NAME[p.size])

		State.APPROACH:
			if _advance(p, dt):
				var exit_x := HEAVY_EXIT_X if p.size == Size.HEAVY else EXIT_X
				var roll := exit_x - RW_START
				p.decel = (APPROACH_SPEED * APPROACH_SPEED - TAXI_SPEED * TAXI_SPEED) / (2.0 * roll)
				_set_path(p, State.LANDING, [Vector2(exit_x, RW_Y)], APPROACH_SPEED)

		State.LANDING:
			p.speed = max(TAXI_SPEED, p.speed - p.decel * dt)
			if _advance(p, dt):
				var sp := _stand_pos(p.stand)
				_set_path(p, State.TAXI_IN, [Vector2(p.pos.x, LANE_Y), Vector2(sp.x, LANE_Y), sp], TAXI_SPEED)

		State.TAXI_IN:
			if runway_user == p and p.pos.y >= RW_Y + 1.2:
				runway_user = null
			if _taxi(p, dt):
				p.state = State.AT_STAND
				p.timer = SIZE_TURNAROUND[p.size]

		State.AT_STAND:
			p.timer -= dt
			if p.timer <= 0.0:
				var fee: int = SIZE_FEE[p.size]
				money += fee
				handled += 1
				popups.append({"pos": p.pos, "text": "+$%d" % fee, "t": 1.5})
				stands[p.stand].user = null
				p.stand = -1
				_set_path(p, State.PUSHBACK, [Vector2(p.pos.x, LANE_Y)], PUSHBACK_SPEED, true)

		State.PUSHBACK:
			if _taxi(p, dt):
				_set_path(p, State.TAXI_OUT, [Vector2(RW_START, LANE_Y), HOLD_SHORT], TAXI_SPEED)

		State.TAXI_OUT:
			if _taxi(p, dt):
				p.state = State.HOLD_SHORT
				departure_queue.append(p)

		State.TAKEOFF:
			p.speed = min(TAKEOFF_TOP_SPEED, p.speed + 3.0 * dt)
			var done := _advance(p, dt)
			if runway_user == p and p.path_i >= 2:
				runway_user = null
			if done:
				p.state = State.GONE


## Moves along the path unless another plane on the ground is too close ahead.
func _taxi(p: Aircraft, dt: float) -> bool:
	p.blocked_by = _blocker(p)
	if p.blocked_by != null:
		p.blocked_time += dt
		return false
	p.blocked_time = 0.0
	return _advance(p, dt)


func _blocker(p: Aircraft) -> Aircraft:
	if p.path_i >= p.path.size():
		return null
	var dir: Vector2 = (p.path[p.path_i] - p.pos)
	if dir.length() < 0.001:
		return null
	dir = dir.normalized()
	for o in planes:
		if o == p or not (o.state in GROUND_STATES):
			continue
		var rel := o.pos - p.pos
		var along := rel.dot(dir)
		if along <= 0.05:
			continue
		if abs(rel.cross(dir)) > 0.8:
			continue
		if along < SIZE_R[p.size] + SIZE_R[o.size] + 0.4:
			# Two planes blocking each other: the older one goes first.
			if o.blocked_by == p and p.id < o.id:
				continue
			return o
	return null


## Moves the plane along its path. Returns true when the end is reached.
func _advance(p: Aircraft, dt: float) -> bool:
	var step := p.speed * dt
	while step > 0.0 and p.path_i < p.path.size():
		var target: Vector2 = p.path[p.path_i]
		var d := target - p.pos
		var dist := d.length()
		if dist > 0.001:
			p.heading = d.angle() + (PI if p.reverse else 0.0)
		if dist <= step:
			p.pos = target
			step -= dist
			p.path_i += 1
		else:
			p.pos += d / dist * step
			step = 0.0
	return p.path_i >= p.path.size()


func _crash(p: Aircraft, why: String) -> void:
	crashes += 1
	crash_marks.append({"pos": p.pos, "t": 4.0})
	p.state = State.GONE
	lbl_msg.text = "CRASH %d/%d: %s!" % [crashes, MAX_CRASHES, why]
	if crashes >= MAX_CRASHES:
		game_over = true
		lbl_over.text = "RUN OVER\n\nSurvived %s\nPlanes handled: %d\nMoney: $%s" % [_fmt_time(elapsed), handled, _fmt_money(money)]
		overlay.visible = true


# ---------------------------------------------------------------- buying

func _buy_stand(size: int) -> void:
	var cost := LARGE_STAND_COST if size == Size.HEAVY else STAND_COST
	for s in stands:
		if not s.owned and s.size == size:
			if money < cost:
				lbl_msg.text = "Not enough money."
				return
			money -= cost
			s.owned = true
			lbl_msg.text = "Built a %s stand." % ("large" if size == Size.HEAVY else "medium")
			return


func _buy_long_runway() -> void:
	if long_runway:
		return
	if money < LONG_RUNWAY_COST:
		lbl_msg.text = "Not enough money."
		return
	money -= LONG_RUNWAY_COST
	long_runway = true
	lbl_msg.text = "Runway extended. Heavies arrive once you own a large stand."


# ---------------------------------------------------------------- UI

func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)

	var panel := PanelContainer.new()
	panel.position = Vector2(1075, 10)
	panel.custom_minimum_size = Vector2(195, 0)
	layer.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
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
	slider.value_changed.connect(func(v): rate = v; spawn_timer = min(spawn_timer, 60.0 / rate))
	box.add_child(slider)

	box.add_child(HSeparator.new())
	btn_stand = Button.new()
	btn_stand.pressed.connect(func(): _buy_stand(Size.MEDIUM))
	box.add_child(btn_stand)
	btn_large = Button.new()
	btn_large.pressed.connect(func(): _buy_stand(Size.HEAVY))
	box.add_child(btn_large)
	btn_runway = Button.new()
	btn_runway.pressed.connect(_buy_long_runway)
	box.add_child(btn_runway)

	box.add_child(HSeparator.new())
	var speeds := HBoxContainer.new()
	box.add_child(speeds)
	for s in [["||", 0.0], ["1x", 1.0], ["2x", 2.0], ["3x", 3.0]]:
		var b := Button.new()
		b.text = s[0]
		var v: float = s[1]
		b.pressed.connect(func(): sim_speed = v)
		speeds.add_child(b)

	box.add_child(HSeparator.new())
	lbl_msg = Label.new()
	lbl_msg.autowrap_mode = TextServer.AUTOWRAP_WORD
	lbl_msg.custom_minimum_size = Vector2(185, 60)
	lbl_msg.text = "Planes land on their own. Set how many arrive per minute and expand the airport. 3 crashes end the run."
	box.add_child(lbl_msg)

	var legend := Label.new()
	legend.add_theme_font_size_override("font_size", 12)
	legend.text = "Yellow: small (Cessna)\nBlue: medium (A321)\nOrange: heavy (A380)\nRing = fuel left"
	box.add_child(legend)

	# Game over overlay
	overlay = ColorRect.new()
	overlay.color = Color(0, 0, 0, 0.6)
	overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
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
	var holding := 0
	for p in planes:
		if p.state == State.HOLDING:
			holding += 1
	lbl_stats.text = "Money: $%s\nCrashes: %d / %d\nHandled: %d\nHolding: %d\nTime: %s" % [
		_fmt_money(money), crashes, MAX_CRASHES, handled, holding, _fmt_time(elapsed)]
	lbl_rate.text = "Arrivals per minute: %d" % int(rate)

	var med_left := stands.any(func(s): return not s.owned and s.size == Size.MEDIUM)
	btn_stand.text = "Medium stand ($3,000)" if med_left else "Medium stand (max)"
	btn_stand.disabled = not med_left or money < STAND_COST
	var large_left := stands.any(func(s): return not s.owned and s.size == Size.HEAVY)
	btn_large.text = "Large stand ($7,000)" if large_left else "Large stand (max)"
	btn_large.disabled = not large_left or money < LARGE_STAND_COST
	btn_runway.text = "Long runway ($15,000)" if not long_runway else "Long runway (built)"
	btn_runway.disabled = long_runway or money < LONG_RUNWAY_COST


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


func _rect(r: Rect2) -> Rect2:
	return Rect2(_t(r.position), r.size * TILE)


func _draw() -> void:
	var font := ThemeDB.fallback_font
	# Airfield (the part you own) and its border.
	draw_rect(_rect(Rect2(0, 0, FIELD, FIELD)), Color(0.24, 0.42, 0.24))
	draw_rect(_rect(Rect2(0, 0, FIELD, FIELD)), Color(0.9, 0.9, 0.9, 0.35), false, 2.0)
	draw_string(font, _t(Vector2(0.5, FIELD - 0.6)), "Starting airfield 50 x 50", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(1, 1, 1, 0.5))

	# Runway
	var rw_end := RW_END_LONG if long_runway else RW_END_SHORT
	var asphalt := Color(0.22, 0.22, 0.24)
	draw_rect(_rect(Rect2(RW_START - 1, RW_Y - 0.9, rw_end - RW_START + 2, 1.8)), asphalt)
	var x := RW_START + 1.0
	while x < rw_end - 1.0:
		draw_line(_t(Vector2(x, RW_Y)), _t(Vector2(x + 1.0, RW_Y)), Color(0.95, 0.95, 0.95), 2.0)
		x += 2.0
	if not long_runway:
		draw_rect(_rect(Rect2(RW_END_SHORT + 1, RW_Y - 0.9, RW_END_LONG - RW_END_SHORT, 1.8)), Color(1, 1, 1, 0.25), false, 1.0)
		draw_string(font, _t(Vector2(RW_END_SHORT + 2, RW_Y + 0.3)), "long runway: $15k", HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(1, 1, 1, 0.5))
	draw_string(font, _t(Vector2(RW_START - 0.8, RW_Y - 1.2)), "RWY 09", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(1, 1, 1, 0.8))

	# Taxiways
	var taxi := Color(0.32, 0.32, 0.34)
	var lane_end := HEAVY_EXIT_X if long_runway else EXIT_X
	var w := 0.8 * TILE
	draw_line(_t(Vector2(RW_START, LANE_Y)), _t(Vector2(lane_end, LANE_Y)), taxi, w)
	draw_line(_t(Vector2(RW_START, RW_Y)), _t(Vector2(RW_START, LANE_Y)), taxi, w)
	draw_line(_t(Vector2(EXIT_X, RW_Y)), _t(Vector2(EXIT_X, LANE_Y)), taxi, w)
	if long_runway:
		draw_line(_t(Vector2(HEAVY_EXIT_X, RW_Y)), _t(Vector2(HEAVY_EXIT_X, LANE_Y)), taxi, w)
	draw_line(_t(Vector2(RW_START, LANE_Y)), _t(Vector2(lane_end, LANE_Y)), Color(0.9, 0.8, 0.2, 0.7), 1.0)
	draw_line(_t(HOLD_SHORT + Vector2(-0.5, 0)), _t(HOLD_SHORT + Vector2(0.5, 0)), Color(0.95, 0.8, 0.1), 3.0)

	# Terminal and stands
	draw_rect(_rect(TERMINAL), Color(0.7, 0.72, 0.75))
	draw_string(font, _t(TERMINAL.position + Vector2(0.5, 1.7)), "Terminal", HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(0.15, 0.15, 0.15))
	for i in stands.size():
		var s: Dictionary = stands[i]
		var sp := _stand_pos(i)
		var half := 1.7 if s.size == Size.HEAVY else 1.2
		var r := Rect2(sp - Vector2(half, half), Vector2(half, half) * 2)
		if s.owned:
			draw_line(_t(Vector2(sp.x, LANE_Y)), _t(sp), taxi, w)
			draw_rect(_rect(r), Color(0.3, 0.3, 0.33))
			draw_rect(_rect(r), Color(0.95, 0.8, 0.1, 0.8), false, 1.0)
		else:
			draw_rect(_rect(r), Color(1, 1, 1, 0.3), false, 1.0)
			draw_string(font, _t(sp + Vector2(-half + 0.1, 0.3)), "$7k" if s.size == Size.HEAVY else "$3k", HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(1, 1, 1, 0.5))

	# Holding pattern
	draw_arc(_t(HOLD_FIX), HOLD_RADIUS * TILE, 0, TAU, 48, Color(1, 1, 1, 0.15), 1.0)
	draw_string(font, _t(HOLD_FIX + Vector2(-2.2, 0.3)), "Holding", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(1, 1, 1, 0.5))

	# Planes
	for p in planes:
		_draw_plane(p)

	# Turnaround progress bars
	for p in planes:
		if p.state == State.AT_STAND:
			var frac: float = 1.0 - p.timer / SIZE_TURNAROUND[p.size]
			var base := _t(p.pos + Vector2(-1.0, 1.4))
			draw_rect(Rect2(base, Vector2(2.0 * TILE, 3)), Color(0, 0, 0, 0.5))
			draw_rect(Rect2(base, Vector2(2.0 * TILE * frac, 3)), Color(0.4, 0.9, 1.0))

	for m in crash_marks:
		var c := _t(m.pos)
		var a: float = clamp(m.t / 4.0, 0.0, 1.0)
		draw_circle(c, 14.0 * (2.0 - a), Color(1, 0.4, 0.1, 0.5 * a))
		draw_line(c + Vector2(-8, -8), c + Vector2(8, 8), Color(1, 0.1, 0.1, a), 3.0)
		draw_line(c + Vector2(-8, 8), c + Vector2(8, -8), Color(1, 0.1, 0.1, a), 3.0)

	for m in popups:
		var y: float = (1.5 - m.t) * 12.0
		draw_string(font, _t(m.pos) + Vector2(-14, -18 - y), m.text, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(0.5, 1, 0.5, m.t / 1.5))


func _draw_plane(p: Aircraft) -> void:
	var r: float = SIZE_R[p.size] * TILE
	var pts := PackedVector2Array()
	for v in PLANE_SHAPE:
		pts.append(_t(p.pos) + (v as Vector2).rotated(p.heading) * r)
	draw_colored_polygon(pts, SIZE_COLOR[p.size])
	if p.state == State.HOLDING:
		var frac: float = clamp(p.fuel / MAX_FUEL, 0.0, 1.0)
		var col := Color(1, 0.2, 0.2).lerp(Color(0.3, 1, 0.3), frac)
		draw_arc(_t(p.pos), r + 5, -PI / 2, -PI / 2 + TAU * frac, 24, col, 2.0)


# ---------------------------------------------------------------- headless self-test

## Runs the simulation without rendering and prints the result.
## godot --headless --path . -- --selftest rate=4 seconds=600 [stands] [runway]
func _selftest(args: PackedStringArray) -> void:
	var seconds := 600.0
	for a in args:
		if a.begins_with("rate="):
			rate = float(a.substr(5))
		elif a.begins_with("seconds="):
			seconds = float(a.substr(8))
	if "stands" in args:
		money += 20000
		_buy_stand(Size.MEDIUM)
		_buy_stand(Size.HEAVY)
	if "runway" in args:
		money += 15000
		_buy_long_runway()
	var max_ground := 0
	var max_blocked := 0.0
	while elapsed < seconds and not game_over:
		_step(1.0 / 60.0)
		var g := 0
		for p in planes:
			if p.state in GROUND_STATES or p.state == State.AT_STAND:
				g += 1
		max_ground = max(max_ground, g)
		for p in planes:
			max_blocked = max(max_blocked, p.blocked_time)
	print("SELFTEST rate=%d time=%s handled=%d crashes=%d money=%d planes_left=%d max_on_ground=%d max_blocked=%.1fs game_over=%s" % [
		int(rate), _fmt_time(elapsed), handled, crashes, money, planes.size(), max_ground, max_blocked, game_over])
	get_tree().quit()


## Plays for a while at high speed, then saves a screenshot (needs a display, e.g. xvfb-run).
## godot --path . -- --shot=out.png [rate=4] [after=90]
func _screenshot(path: String, args: PackedStringArray) -> void:
	var after := 90.0
	for a in args:
		if a.begins_with("rate="):
			rate = float(a.substr(5))
		elif a.begins_with("after="):
			after = float(a.substr(6))
	if "runway" in args:
		money += 35000
		_buy_long_runway()
		_buy_stand(Size.MEDIUM)
		_buy_stand(Size.HEAVY)
	while elapsed < after:
		_step(1.0 / 60.0)
	sim_speed = 0.0
	_update_ui()
	queue_redraw()
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(path)
	get_tree().quit()
