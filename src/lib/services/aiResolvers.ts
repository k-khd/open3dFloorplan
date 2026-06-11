import { get } from 'svelte/store';
import { currentProject } from '$lib/stores/project';
import type { Floor, Room, Wall, Point } from '$lib/models/types';

export function getActiveFloor(): Floor | null {
  const p = get(currentProject);
  if (!p) return null;
  return p.floors.find((f) => f.id === p.activeFloorId) ?? null;
}

/** Find a room by (fuzzy) name. */
export function resolveRoom(floor: Floor, name: string): Room | null {
  if (!name) return null;
  const q = name.toLowerCase().trim();
  return (
    floor.rooms.find((r) => r.name.toLowerCase() === q) ??
    floor.rooms.find((r) => r.name.toLowerCase().includes(q) || q.includes(r.name.toLowerCase())) ??
    null
  );
}

export interface Bounds {
  minX: number; maxX: number; minY: number; maxY: number; centerX: number; centerY: number;
}

export function roomBounds(floor: Floor, room: Room): Bounds {
  const ws = floor.walls.filter((w) => room.walls.includes(w.id));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const w of ws) {
    minX = Math.min(minX, w.start.x, w.end.x);
    maxX = Math.max(maxX, w.start.x, w.end.x);
    minY = Math.min(minY, w.start.y, w.end.y);
    maxY = Math.max(maxY, w.start.y, w.end.y);
  }
  return { minX, maxX, minY, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}

/** Find the wall on a given side of a room (boven/onder/links/rechts). */
export function resolveWall(floor: Floor, room: Room, dir: string): Wall | null {
  const ws = floor.walls.filter((w) => room.walls.includes(w.id));
  if (ws.length === 0) return null;
  const allX = ws.flatMap((w) => [w.start.x, w.end.x]);
  const allY = ws.flatMap((w) => [w.start.y, w.end.y]);
  for (const w of ws) {
    const horiz = w.start.y === w.end.y;
    const vert = w.start.x === w.end.x;
    if (dir === 'boven' && horiz && w.start.y === Math.min(...allY)) return w;
    if (dir === 'onder' && horiz && w.start.y === Math.max(...allY)) return w;
    if (dir === 'rechts' && vert && w.start.x === Math.max(...allX)) return w;
    if (dir === 'links' && vert && w.start.x === Math.min(...allX)) return w;
  }
  return null;
}

/** Convert a Dutch direction into an x/y point inside the room bounds. */
export function positionInRoom(b: Bounds, dir?: string): Point {
  switch (dir) {
    case 'boven': return { x: b.centerX, y: b.minY + 50 };
    case 'onder': return { x: b.centerX, y: b.maxY - 50 };
    case 'rechts': return { x: b.maxX - 50, y: b.centerY };
    case 'links': return { x: b.minX + 50, y: b.centerY };
    case 'midden': return { x: b.centerX, y: b.centerY };
    default: return { x: b.centerX, y: b.centerY };
  }
}

/** Default rotation for furniture given a placement direction. */
export function rotationForDirection(dir?: string): number {
  if (dir === 'links') return 270;
  if (dir === 'rechts') return 90;
  if (dir === 'onder') return 180;
  return 0;
}

/** Find a furniture item inside a room by keyword (matches the catalogId). */
export function resolveFurnitureInRoom(floor: Floor, room: Room, keyword: string) {
  const b = roomBounds(floor, room);
  const inRoom = floor.furniture.filter(
    (f) => f.position.x >= b.minX && f.position.x <= b.maxX && f.position.y >= b.minY && f.position.y <= b.maxY,
  );
  const k = (keyword || '').toLowerCase().trim();
  if (!k) return inRoom[0] ?? null;
  return inRoom.find((f) => f.catalogId.toLowerCase().includes(k)) ?? inRoom[0] ?? null;
}

/** 
 * Parse informal Dutch dimensions: 
 * "5 bij 4", "5x4", "5 op 4", "5 × 4". Returns meters. 
*/
export function parseDimensions(text: string): { width: number; height: number } | null {
  if (!text) return null;
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:bij|x|×|op)\s*(\d+(?:[.,]\d+)?)/i);
  if (!m) return null;
  return {
    width: parseFloat(m[1].replace(',', '.')),
    height: parseFloat(m[2].replace(',', '.')),
  };
}
