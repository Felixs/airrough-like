import { Vector3 } from '@babylonjs/core';
import { TILE_SIZE } from '../sim/layout';

/**
 * The 3D view uses the simulation's world units (1 tile = TILE_SIZE units) on the ground plane: the simulation's x is
 * east, its y is south, so a point (x, y) is drawn at (x, height, −y). One tile stands for 16 m.
 */
export const METRE = TILE_SIZE / 16;

export const mapPoint = (x: number, y: number, height = 0): Vector3 => new Vector3(x, height, -y);
