class_name Aircraft
extends RefCounted
## One plane. Positions are in tile units (a tile's centre is at x + 0.5, y + 0.5).

enum Size { SMALL, MEDIUM, HEAVY }
enum State { HOLDING, APPROACH, LANDING, TAXI_IN, AT_STAND, PUSHBACK, TAXI_OUT, HOLD_SHORT, TAKEOFF, GONE }

const NAMES := ["Small", "Medium", "Heavy"]
const RADIUS := [0.6, 1.0, 1.5]          # in tiles, for drawing and spacing
const FEE := [300, 600, 1200]
const TURNAROUND := [10.0, 20.0, 40.0]   # seconds at the stand
const MIN_ROLL := [6, 12, 20]            # runway tiles rolled before the plane can exit
const COLOR := [Color(0.95, 0.95, 0.6), Color(0.85, 0.92, 1.0), Color(1.0, 0.75, 0.55)]
## States in which the plane is on a taxiway and keeps its distance from others.
const GROUND_STATES := [State.TAXI_IN, State.PUSHBACK, State.TAXI_OUT, State.HOLD_SHORT]

var id := 0
var size := Size.SMALL
var state := State.HOLDING
var pos := Vector2.ZERO
var heading := 0.0
var path: Array = []         # Array of Vector2 waypoints
var path_i := 0
var speed := 0.0
var decel := 0.0
var reverse := false         # pushback: drawn facing backwards
var fuel := 90.0
var timer := 0.0
var hold_angle := 0.0

var stand_id := -1           # piece id of the reserved stand
var runway_id := -1          # piece id of the runway used for landing or departure
var runway_index := 0        # runway tile where the plane leaves (landing) or enters (takeoff)
var ground: Array = []       # taxi route (Array of Vector2i); its tiles can't be bulldozed
var paid := false

var blocked_by: Aircraft = null
var blocked_time := 0.0
var ghost_time := 0.0        # anti-jam fallback: ignores spacing for a moment
var retry_timer := 0.0


func set_path(new_state: int, waypoints: Array, new_speed: float, backwards := false) -> void:
	state = new_state
	path = waypoints
	path_i = 0
	speed = new_speed
	reverse = backwards


## Moves along the path. Returns true when the last waypoint is reached.
func advance(dt: float) -> bool:
	var step := speed * dt
	while step > 0.0 and path_i < path.size():
		var target: Vector2 = path[path_i]
		var d := target - pos
		var dist := d.length()
		if dist > 0.001:
			heading = d.angle() + (PI if reverse else 0.0)
		if dist <= step:
			pos = target
			step -= dist
			path_i += 1
		else:
			pos += d / dist * step
			step = 0.0
	return path_i >= path.size()


func move_dir() -> Vector2:
	if path_i >= path.size():
		return Vector2.ZERO
	var d: Vector2 = path[path_i] - pos
	return d.normalized() if d.length() > 0.001 else Vector2.ZERO
