class_name AirportLayout
extends RefCounted
## The buildable grid: which piece sits on which tile, placement rules and taxi pathfinding.

const W := 50
const H := 50

enum Tile { EMPTY, TAXIWAY, RUNWAY, STAND, TERMINAL }
enum Kind { TAXIWAY, SHORT_RUNWAY, LONG_RUNWAY, MEDIUM_STAND, LARGE_STAND, TERMINAL }

const NAMES := {
	Kind.TAXIWAY: "Taxiway", Kind.SHORT_RUNWAY: "Short runway", Kind.LONG_RUNWAY: "Long runway",
	Kind.MEDIUM_STAND: "Medium stand", Kind.LARGE_STAND: "Large stand", Kind.TERMINAL: "Terminal",
}
const COST := {
	Kind.TAXIWAY: 150, Kind.SHORT_RUNWAY: 8000, Kind.LONG_RUNWAY: 20000,
	Kind.MEDIUM_STAND: 3000, Kind.LARGE_STAND: 7000, Kind.TERMINAL: 0,
}
const BUILD_TIME := {
	Kind.TAXIWAY: 1.0, Kind.SHORT_RUNWAY: 20.0, Kind.LONG_RUNWAY: 40.0,
	Kind.MEDIUM_STAND: 15.0, Kind.LARGE_STAND: 15.0, Kind.TERMINAL: 0.0,
}
const RUNWAY_LENGTH := {Kind.SHORT_RUNWAY: 20, Kind.LONG_RUNWAY: 32}
const STAND_FOOTPRINT := {Kind.MEDIUM_STAND: 2, Kind.LARGE_STAND: 3}
const HOLD_MAX_INDEX := 3   # a departure lines up within the first 4 runway tiles

## Landing/takeoff direction of a runway: east, south, west, north.
const DIRS := [Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0), Vector2i(0, -1)]
const DIR_NAMES := ["east", "south", "west", "north"]

var tiles := PackedInt32Array()
var owner := PackedInt32Array()   # piece id per tile, -1 if empty
var pieces := {}                  # id -> Dictionary
var next_id := 1
var astar := AStarGrid2D.new()
var dirty := true


func _init() -> void:
	tiles.resize(W * H)
	owner.resize(W * H)
	tiles.fill(Tile.EMPTY)
	owner.fill(-1)
	astar.region = Rect2i(0, 0, W, H)
	astar.diagonal_mode = AStarGrid2D.DIAGONAL_MODE_NEVER
	astar.default_compute_heuristic = AStarGrid2D.HEURISTIC_MANHATTAN
	astar.update()


# ---------------------------------------------------------------- tiles

static func inside(c: Vector2i) -> bool:
	return c.x >= 0 and c.y >= 0 and c.x < W and c.y < H


func tile(c: Vector2i) -> int:
	return tiles[c.y * W + c.x] if inside(c) else -1


func piece_at(c: Vector2i) -> Dictionary:
	if not inside(c):
		return {}
	return pieces.get(owner[c.y * W + c.x], {})


static func center(c: Vector2i) -> Vector2:
	return Vector2(c) + Vector2(0.5, 0.5)


func is_ready(p: Dictionary, now: float) -> bool:
	return now >= p.ready_at


static func is_runway(kind: int) -> bool:
	return kind == Kind.SHORT_RUNWAY or kind == Kind.LONG_RUNWAY


static func is_stand(kind: int) -> bool:
	return kind == Kind.MEDIUM_STAND or kind == Kind.LARGE_STAND


static func tile_type_for(kind: int) -> int:
	if kind == Kind.TAXIWAY:
		return Tile.TAXIWAY
	if is_runway(kind):
		return Tile.RUNWAY
	if is_stand(kind):
		return Tile.STAND
	return Tile.TERMINAL


# ---------------------------------------------------------------- placing

static func cells_for(kind: int, origin: Vector2i, dir: int, size := Vector2i.ONE) -> Array[Vector2i]:
	var out: Array[Vector2i] = []
	if is_runway(kind):
		for i in RUNWAY_LENGTH[kind]:
			out.append(origin + DIRS[dir] * i)
	elif is_stand(kind):
		var n: int = STAND_FOOTPRINT[kind]
		for y in n:
			for x in n:
				out.append(origin + Vector2i(x, y))
	elif kind == Kind.TERMINAL:
		for y in size.y:
			for x in size.x:
				out.append(origin + Vector2i(x, y))
	else:
		out.append(origin)
	return out


## Returns "" if the piece can be placed, otherwise the reason it can't.
func can_place(kind: int, origin: Vector2i, dir: int) -> String:
	var cells := cells_for(kind, origin, dir)
	for c in cells:
		if not inside(c):
			return "Outside the airfield"
		if tile(c) != Tile.EMPTY:
			return "Tiles are not free"
	if is_stand(kind):
		for c in _neighbours_of(cells):
			if tile(c) == Tile.TAXIWAY:
				return ""
		return "A stand must touch a taxiway"
	return ""


func place(kind: int, origin: Vector2i, dir: int, ready_at: float, size := Vector2i.ONE) -> int:
	var id := next_id
	next_id += 1
	var cells := cells_for(kind, origin, dir, size)
	var p := {
		"id": id, "kind": kind, "cells": cells, "origin": origin, "dir": dir,
		"ready_at": ready_at, "cost": COST[kind],
		"user": null,      # runway: plane using it; stand: plane parked or on its way
		"queue": [],       # runway: departures waiting at the hold-short point
		"last_emergency": false,
	}
	pieces[id] = p
	for c in cells:
		tiles[c.y * W + c.x] = tile_type_for(kind)
		owner[c.y * W + c.x] = id
	dirty = true
	return id


func remove(id: int) -> void:
	var p: Dictionary = pieces.get(id, {})
	if p.is_empty():
		return
	for c in p.cells:
		tiles[c.y * W + c.x] = Tile.EMPTY
		owner[c.y * W + c.x] = -1
	pieces.erase(id)
	dirty = true


func _neighbours_of(cells: Array) -> Array[Vector2i]:
	var out: Array[Vector2i] = []
	for c in cells:
		for d in DIRS:
			var n: Vector2i = c + d
			if inside(n) and not cells.has(n) and not out.has(n):
				out.append(n)
	return out


# ---------------------------------------------------------------- pathfinding

## Rebuilds the taxi graph: only finished taxiway tiles can be used.
func rebuild(now: float) -> void:
	astar.fill_solid_region(astar.region, true)
	for p in pieces.values():
		if p.kind == Kind.TAXIWAY and is_ready(p, now):
			for c in p.cells:
				astar.set_point_solid(c, false)
	dirty = false


## Taxi route between two taxiway tiles (both included), or [] if there is none.
func taxi_path(from: Vector2i, to: Vector2i) -> Array[Vector2i]:
	if astar.is_point_solid(from) or astar.is_point_solid(to):
		return []
	return astar.get_id_path(from, to)


func _ready_taxi(c: Vector2i, now: float) -> bool:
	if tile(c) != Tile.TAXIWAY:
		return false
	return is_ready(piece_at(c), now)


# ---------------------------------------------------------------- runways

func runways(now: float) -> Array:
	return pieces.values().filter(func(p): return is_runway(p.kind) and is_ready(p, now))


func stands(now: float) -> Array:
	return pieces.values().filter(func(p): return is_stand(p.kind) and is_ready(p, now))


static func runway_max_size(p: Dictionary) -> int:
	return Aircraft.Size.HEAVY if p.kind == Kind.LONG_RUNWAY else Aircraft.Size.MEDIUM


func _side_taxi(p: Dictionary, index: int, now: float) -> Vector2i:
	var c: Vector2i = p.cells[index]
	for side in [DIRS[(p.dir + 1) % 4], DIRS[(p.dir + 3) % 4]]:
		if _ready_taxi(c + side, now):
			return c + side
	return Vector2i(-1, -1)


## First runway tile at or after the plane's minimum roll that has a taxiway beside it.
func runway_exit(p: Dictionary, size: int, now: float) -> Dictionary:
	for i in range(Aircraft.MIN_ROLL[size], p.cells.size()):
		var t := _side_taxi(p, i, now)
		if t.x >= 0:
			return {"index": i, "taxi": t}
	return {}


## Taxiway tile next to the start of the runway, where departures wait.
func runway_hold(p: Dictionary, now: float) -> Dictionary:
	for i in range(0, min(HOLD_MAX_INDEX + 1, p.cells.size())):
		var t := _side_taxi(p, i, now)
		if t.x >= 0:
			return {"index": i, "taxi": t}
	return {}


## Why a runway can't be used yet, or "" if it works for small planes.
func runway_problem(p: Dictionary, now: float) -> String:
	if not is_ready(p, now):
		return ""
	if runway_hold(p, now).is_empty():
		return "needs a taxiway at its start"
	if runway_exit(p, Aircraft.Size.SMALL, now).is_empty():
		return "needs an exit taxiway"
	return ""


# ---------------------------------------------------------------- stands

static func stand_max_size(p: Dictionary) -> int:
	return Aircraft.Size.HEAVY if p.kind == Kind.LARGE_STAND else Aircraft.Size.MEDIUM


static func stand_center(p: Dictionary) -> Vector2:
	var n: int = STAND_FOOTPRINT[p.kind]
	return Vector2(p.origin) + Vector2(n, n) / 2.0


## The taxiway tile a plane uses to enter and leave the stand.
func stand_access(p: Dictionary, now: float) -> Vector2i:
	for c in _neighbours_of(p.cells):
		if _ready_taxi(c, now):
			return c
	return Vector2i(-1, -1)
