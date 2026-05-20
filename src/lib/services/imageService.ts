import { get } from 'svelte/store';
import { currentProject, loadProject } from '$lib/stores/project';
import type { Wall, Room, Point } from '$lib/models/types';
import { detectRooms } from '$lib/utils/roomDetection';
import {
  loadImageForDetection,
  detectWallSegments,
  mergeParallelWalls,
  pixelToWorld,
  type DetectedImage,
  type DetectedSegment,
} from '$lib/utils/wallDetection';

// What the AI returns: one number for the whole plan scale + a list of rooms (no positions, AI is unreliable for those)
interface ScanInfo {
  total_width_m?: number;
  rooms?: { name: string; width_m: number; height_m: number }[];
}

const DEFAULT_WALL_THICKNESS = 15;
const DEFAULT_WALL_HEIGHT = 280;
const DEFAULT_WALL_COLOR = '#444444';
const UNITS_PER_METER = 100;

// Max distance (working pixels) between parallel CV lines that we consider one wall (double-line wall fix)
const PARALLEL_WALL_GAP_PX = 30;

// Minimum snap tolerance (world units) for joining wall endpoints. We grow this based on scale.
const MIN_SNAP_TOLERANCE = 30;

// Sanity bounds on AI-derived scale (cm per pixel). Outside this range we ignore the AI's number.
const MIN_VALID_SCALE = 0.1;
const MAX_VALID_SCALE = 50;


// Main entry point. CV does the lines, AI does the scale and labels, detectRooms ties it together.
export async function scanAndBuildFloorplan(): Promise<{ ok: boolean; message: string }> {
  const project = get(currentProject);
  if (!project) return { ok: false, message: 'No project loaded.' };

  const floor = project.floors.find(f => f.id === project.activeFloorId);
  if (!floor) return { ok: false, message: 'No active floor loaded.' };

  const bg = floor.backgroundImage;
  if (!bg?.dataUrl) {
    return { ok: false, message: 'Upload a floor plan image first using the background image button.' };
  }

  // 1) Load image into a working canvas (downscaled if huge)
  let image: DetectedImage;
  try {
    image = await loadImageForDetection(bg.dataUrl);
  } catch {
    return { ok: false, message: 'Could not decode the background image.' };
  }

  // 2) CV: detect the actual wall lines on the photo (parallel, fast) + AI for scale and labels (parallel, slow)
  const cvPromise = Promise.resolve().then(() => {
    const raw = detectWallSegments(image);
    return mergeParallelWalls(raw, PARALLEL_WALL_GAP_PX);
  });
  const aiPromise = fetchScanInfo(bg.dataUrl).catch(() => null);

  const [segments, aiInfo] = await Promise.all([cvPromise, aiPromise]);

  if (segments.length === 0) {
    return { ok: false, message: 'CV could not detect any walls. Try a clearer image with more contrast.' };
  }

  // 3) Compute the AI-derived scale (one number for the whole plan). Fall back to bg.scale if AI was unhelpful.
  const wallBboxWorking = computeBoundingBox(segments);
  const aiScale = computeAiScale(aiInfo, wallBboxWorking.width / image.scaleFactor);
  const effectiveScale = aiScale ?? bg.scale ?? 1;

  // 4) Convert pixel segments to world coordinates using the chosen scale, then snap endpoints together
  const cvWalls = segmentsToWalls(segments, image, effectiveScale, bg.position);
  const snapTolerance = Math.max(MIN_SNAP_TOLERANCE, effectiveScale * 4); // 4 pixels of slack, in world units
  const snappedWalls = snapEndpoints(cvWalls, snapTolerance);

  // 5) Let the existing room-cycle detector find closed rooms in the snapped walls
  const detectedRooms = detectRooms(snappedWalls);

  // 6) Use the AI room list to label detected rooms (sorted by area, biggest with biggest)
  const labeledRooms = matchRoomNames(detectedRooms, aiInfo?.rooms ?? []);

  // 7) Apply by appending to the active floor. Also sync bg.scale so the photo aligns visually with the walls.
  const updatedProject = { ...project };
  const activeFloor = updatedProject.floors.find(f => f.id === updatedProject.activeFloorId);
  if (!activeFloor) return { ok: false, message: 'No active floor loaded.' };

  activeFloor.walls = [...activeFloor.walls, ...snappedWalls];
  activeFloor.rooms = [...activeFloor.rooms, ...labeledRooms];
  if (aiScale !== null && activeFloor.backgroundImage) {
    activeFloor.backgroundImage = { ...activeFloor.backgroundImage, scale: aiScale };
  }
  loadProject(updatedProject);

  const scaleNote = aiScale !== null ? ` (scale ${aiScale.toFixed(2)} cm/px from AI)` : '';
  const roomsNote = labeledRooms.length > 0 ? `, ${labeledRooms.length} room(s)` : ', no closed rooms detected';
  return { ok: true, message: `Added ${snappedWalls.length} wall(s)${roomsNote}${scaleNote}.` };
}


// --- AI -------------------------------------------------------------------


async function fetchScanInfo(dataUrl: string): Promise<ScanInfo | null> {
  const imageBase64 = dataUrl.split(',')[1];

  const prompt =
    'You are analyzing THIS SPECIFIC floor plan image. Output ONLY a raw JSON object. No prose, no markdown.\n\n' +
    'STRICT RULES:\n' +
    '1. Only return values you can actually see on THIS image. Do NOT invent names like "Living" or "Kitchen".\n' +
    '2. Read all numbers from the dimension labels printed on the image.\n' +
    '3. If you cannot find a value, omit that field or return an empty array. Better empty than guessed.\n' +
    '4. Do NOT copy the placeholder values from the schema below.\n\n' +
    'Required fields:\n' +
    '- "total_width_m": number, the total width of the ENTIRE floor plan in meters (read from the largest horizontal dimension label).\n' +
    '- "rooms": array. Each item has "name" (string, the EXACT label written inside the room such as "Woonkamer" or "Slaapkamer"), "width_m" (number), "height_m" (number). If no rooms have visible labels, return an empty array [].\n\n' +
    'Schema with placeholders (DO NOT copy these values; replace them with what you actually see):\n' +
    '{"total_width_m":<NUMBER>,"rooms":[{"name":"<EXACT_LABEL_FROM_IMAGE>","width_m":<NUMBER>,"height_m":<NUMBER>}]}';

  const response = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'granite3.2-vision',
      stream: false,
      format: 'json',
      messages: [{ role: 'user', content: prompt, images: [imageBase64] }],
    }),
  });

  const data = await response.json();
  console.log('AI scan info raw:', data?.message?.content);
  return parseScanInfo(data?.message?.content ?? '');
}


function parseScanInfo(text: string): ScanInfo | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const raw = JSON.parse(cleaned.substring(start, end + 1)) as Record<string, unknown>;
    return normalizeScanInfo(raw);
  } catch {
    return null;
  }
}


function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}


function normalizeScanInfo(raw: Record<string, unknown>): ScanInfo | null {
  const totalWidth = toFiniteNumber(raw.total_width_m);
  if (totalWidth === null || totalWidth <= 0) return null;

  const rooms: { name: string; width_m: number; height_m: number }[] = [];
  if (Array.isArray(raw.rooms)) {
    for (const item of raw.rooms) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const name = typeof r.name === 'string' ? r.name.trim() : '';
      const width = toFiniteNumber(r.width_m);
      const height = toFiniteNumber(r.height_m);
      if (!name || width === null || height === null || width <= 0 || height <= 0) continue;
      rooms.push({ name, width_m: width, height_m: height });
    }
  }

  return { total_width_m: totalWidth, rooms };
}


// --- scale calculation ----------------------------------------------------


function computeAiScale(info: ScanInfo | null, wallBboxOriginalPx: number): number | null {
  const totalWidthM = info?.total_width_m ?? null;
  if (totalWidthM === null || totalWidthM <= 0) return null;
  if (!Number.isFinite(wallBboxOriginalPx) || wallBboxOriginalPx <= 0) return null;

  const totalWidthWorldUnits = totalWidthM * UNITS_PER_METER;
  const cmPerOriginalPixel = totalWidthWorldUnits / wallBboxOriginalPx;
  if (cmPerOriginalPixel < MIN_VALID_SCALE || cmPerOriginalPixel > MAX_VALID_SCALE) return null;
  return cmPerOriginalPixel;
}


function computeBoundingBox(segments: DetectedSegment[]): { width: number; height: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of segments) {
    minX = Math.min(minX, s.start.x, s.end.x);
    maxX = Math.max(maxX, s.start.x, s.end.x);
    minY = Math.min(minY, s.start.y, s.end.y);
    maxY = Math.max(maxY, s.start.y, s.end.y);
  }
  if (!Number.isFinite(minX)) return { width: 0, height: 0 };
  return { width: maxX - minX, height: maxY - minY };
}


// --- geometry helpers -----------------------------------------------------


function segmentsToWalls(
  segments: DetectedSegment[],
  image: DetectedImage,
  scale: number,
  bgPosition: Point
): Wall[] {
  const idGen = makeIdGenerator();
  return segments.map(seg => ({
    id: idGen('wall'),
    start: pixelToWorld(seg.start.x, seg.start.y, image.scaleFactor, scale, bgPosition, image.originalWidth, image.originalHeight),
    end: pixelToWorld(seg.end.x, seg.end.y, image.scaleFactor, scale, bgPosition, image.originalWidth, image.originalHeight),
    thickness: DEFAULT_WALL_THICKNESS,
    height: DEFAULT_WALL_HEIGHT,
    color: DEFAULT_WALL_COLOR,
  }));
}


function snapEndpoints(walls: Wall[], tolerance: number): Wall[] {
  const clusters: Point[] = [];
  const snap = (p: Point): Point => {
    for (const c of clusters) {
      if (Math.hypot(c.x - p.x, c.y - p.y) <= tolerance) return { x: c.x, y: c.y };
    }
    const np = { x: p.x, y: p.y };
    clusters.push(np);
    return np;
  };
  return walls.map(w => ({ ...w, start: snap(w.start), end: snap(w.end) }));
}


function matchRoomNames(detected: Room[], aiRooms: { name: string; width_m: number; height_m: number }[]): Room[] {
  const sortedDetected = [...detected]
    .map((r, originalIndex) => ({ room: r, originalIndex }))
    .sort((a, b) => (b.room.area ?? 0) - (a.room.area ?? 0));

  const sortedAi = aiRooms
    .filter(r => r && r.name && Number.isFinite(r.width_m) && Number.isFinite(r.height_m))
    .map(r => ({ ...r, area: r.width_m * r.height_m }))
    .sort((a, b) => b.area - a.area);

  const result = new Array<Room>(detected.length);
  sortedDetected.forEach((entry, sortedIndex) => {
    const aiMatch = sortedAi[sortedIndex];
    result[entry.originalIndex] = {
      ...entry.room,
      name: aiMatch?.name?.trim() || entry.room.name || `Room ${entry.originalIndex + 1}`,
    };
  });
  return result;
}


function makeIdGenerator(): (prefix: string) => string {
  const stamp = Date.now().toString(36);
  let seq = 0;
  return (prefix: string) => `${prefix}-${stamp}-${(seq++).toString(36)}`;
}
