import type { Door, Room, Wall } from '$lib/models/types';

export function buildRoomCopy(
  userMessage: string,
  floor: { walls: Wall[]; doors: Door[]; rooms: Room[] },
  allRooms: Room[]
): { walls: Wall[]; doors: Door[]; rooms: Room[] } | null {
  const wallById = new Map(floor.walls.map(w => [w.id, w] as const));
  const hasUsableWallLinks = (room: Room) =>
    Array.isArray(room.walls) &&
    room.walls.some(wallId => {
      if (wallById.has(wallId)) return true;
      const baseId = wallId.split('-copy-')[0];
      return Boolean(baseId && wallById.has(baseId));
    });

  
  // filter user message for lowercase
  const normalized = userMessage.toLowerCase();
  // A map that saves rooms based on their ID, starting with rooms from the floor, then the fallback rooms. Only if the ID is not already present in the map (to avoid duplicates).
  const mergedById = new Map<string, Room>();
  for (const r of floor.rooms) mergedById.set(r.id, r);
  // Prefer detected/allRooms snapshot when ids overlap; it is usually fresher than floor.rooms
  for (const r of allRooms) mergedById.set(r.id, r);

  // Convert the map back to an array of rooms for easier processing.
  const roomPool = Array.from(mergedById.values()).filter(hasUsableWallLinks);
  if (roomPool.length === 0) return null;


  // filter user mesage for copy number of the room
  const requestedRoomNumber = extractRequestedRoomNumber(userMessage);
  let sourceRoom: Room | undefined;


  // if the number of a room is mentioned
  if (requestedRoomNumber !== null) {
    // 1) Primary: "room N" means Nth main room (non-copy), independent of custom names.
    const mainRooms = roomPool.filter(r => !isCopyName(r.name));
    sourceRoom = mainRooms[requestedRoomNumber - 1];

    // 2) Fallback: technical room id pattern (works for ids like room-1-...).
    const roomIdRx = new RegExp(`^room-${requestedRoomNumber}(?:\\b|-)`, 'i');
    const idMatchedRooms = roomPool.filter(r => roomIdRx.test(r.id));

    // 3) Fallback: human name pattern ("Room 1"/"Kamer 1").
    const sameBaseRooms = roomPool.filter(r => {
      const base = normalizeBaseName(r.name);
      return base === `room ${requestedRoomNumber}` || base === `kamer ${requestedRoomNumber}`;
    });

    // if no room is found, match the room based on ID after that on their name
    if (!sourceRoom) {
      const candidates = idMatchedRooms.length > 0 ? idMatchedRooms : sameBaseRooms;
      sourceRoom = candidates.find(r => !isCopyName(r.name)) ?? candidates[0];
    }

    if (!sourceRoom) return null;
  } else {
    // if no room numer is MENTIONED in the userMessage, try to match the room based on their name, then ID, after that the first room that is found in the list
    sourceRoom =
      roomPool.find(r => normalized.includes(toBaseRoomName(r.name).toLowerCase()) && !isCopyName(r.name)) ??
      roomPool.find(r => normalized.includes(toBaseRoomName(r.name).toLowerCase())) ??
      roomPool.find(r => normalized.includes(r.id.toLowerCase())) ??
      roomPool[0];
  }
  if (!sourceRoom || !Array.isArray(sourceRoom.walls) || sourceRoom.walls.length === 0) return null;



  // copy count is determined by user message
  const copyCount = extractCopyCount(userMessage);


  // Collect wall IDs from source room
  const resolvedWallIds: string[] = [];
  for (const wallId of sourceRoom.walls) {
    // does the wall ID exist in the current floor? if yes, save it for copying
    if (wallById.has(wallId)) {
      resolvedWallIds.push(wallId);
      continue;
    }
    // if not, check if it's a copy of a wall that exists in the current floor by removing "copy" and check if that ID exists. if yes, save it for copying
    const baseId = wallId.split('-copy-')[0];

    // check if the base ID exists in the current floor
    if (baseId && wallById.has(baseId)) resolvedWallIds.push(baseId);
  }

  // if no walls are resolved for copying, return null 
  if (resolvedWallIds.length === 0) return null;

  // Gather the actual wall objects for the resolved wall IDs
  const sourceWalls = floor.walls.filter(w => resolvedWallIds.includes(w.id));
  if (sourceWalls.length === 0) return null;


  // Determine the leftmost x-coordinate among the source walls
  let minXSource = Infinity;
  for (const w of sourceWalls) minXSource = Math.min(minXSource, w.start.x, w.end.x);

  // ID generator based on timestamo
  const stamp = Date.now().toString(36);

  // counter to ensure unique IDs
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${stamp}-${(seq++).toString(36)}`;
  const baseRoomName = toBaseRoomName(sourceRoom.name);

  // Use floor.rooms if available, otherwise use the backup rooms from detectedRoomsStore
  const baseRooms = floor.rooms.length > 0 ? [...floor.rooms] : [...allRooms];
  // Create working copies of all walls, doors and rooms - these grow as we add copies
  let workingWalls = [...floor.walls];
  let workingDoors = [...floor.doors];
  let workingRooms = [...baseRooms];


  // Loop for each copy the user wants (e.g. "copy room 1 3 times" = 3 iterations)
  for (let i = 0; i < copyCount; i++) {
    // Build a fresh lookup table from the current working walls (grows each iteration)
    const currentWallById = new Map(workingWalls.map(w => [w.id, w] as const));
    
    // Find all rooms that belong to the same series (e.g. "Room 1", "Room 1 Copy 1", "Room 1 Copy 2")
    const seriesRooms = workingRooms.filter(r =>
      Array.isArray(r.walls) && normalizeBaseName(r.name) === normalizeBaseName(baseRoomName)
    );
    const seriesWallIds = new Set<string>();

    // Collect all wall IDs from the series to find the rightmost x position
    for (const r of seriesRooms) {
      for (const wId of r.walls) {
        if (currentWallById.has(wId)) {
          seriesWallIds.add(wId);
          continue;
        }
        const baseId = wId.split('-copy-')[0];
        if (baseId && currentWallById.has(baseId)) seriesWallIds.add(baseId);
      }
    }

    // Find the rightmost x coordinate of the entire series to place the new copy to the right of the existing series with some spacing (e.g. 100 units)
    let maxXSeries = -Infinity;
    for (const w of workingWalls) {
      if (!seriesWallIds.has(w.id)) continue;
      maxXSeries = Math.max(maxXSeries, w.start.x, w.end.x);
    }
    if (!Number.isFinite(maxXSeries)) {
      for (const w of sourceWalls) maxXSeries = Math.max(maxXSeries, w.start.x, w.end.x);
    }

    // Calculate how far to shift the copy to the right (100 units = 1 meter gap)
    const dx = (maxXSeries + 100) - minXSource;
    if (!Number.isFinite(dx)) break;

     // Create new wall IDs and shift all x coordinates to the right by dx
    const wallIdMap = new Map<string, string>();
    const copiedWalls: Wall[] = sourceWalls.map(w => {
      const newId = nextId(`${w.id}-copy`);
      wallIdMap.set(w.id, newId);
      return {
        ...w,
        id: newId,
        start: { x: w.start.x + dx, y: w.start.y },
        end: { x: w.end.x + dx, y: w.end.y },
        curvePoint: w.curvePoint ? { x: w.curvePoint.x + dx, y: w.curvePoint.y } : undefined
      };
    });


    // Copy all doors that belong to the source room walls, with new IDs pointing to new walls
    const copiedDoors: Door[] = floor.doors
      .filter(d => wallIdMap.has(d.wallId))
      .map(d => ({
        ...d,
        id: nextId(`${d.id}-copy`),
        wallId: wallIdMap.get(d.wallId)!
      }));
    

     // Create the new room object with a numbered copy name
    const copiedRoom: Room = {
      ...sourceRoom,
      id: nextId(`${sourceRoom.id}-copy`),
      name: `${baseRoomName} Copy ${getNextCopyIndex(baseRoomName, workingRooms)}`,
      walls: resolvedWallIds.map(wId => wallIdMap.get(wId) ?? wId)
    };
    

    // Add the copies to the working lists for the next iteration
    workingWalls = [...workingWalls, ...copiedWalls];
    workingDoors = [...workingDoors, ...copiedDoors];
    workingRooms = [...workingRooms, copiedRoom];
  }
  
  // Return everything: original + all copies
  return {
    walls: workingWalls,
    doors: workingDoors,
    rooms: workingRooms
  };
}

// delelets "copy", "copy 1", "copy 2" from the end of the name and trim whitespace to get the base name for matching
function toBaseRoomName(name: string): string {
  return name
    .replace(/\s+copy(?:\s+\d+)?$/i, '')
    .trim();
}

// lowercase, trim and replace multiple spaces with a single space to normalize the name for matching
function normalizeBaseName(name: string): string {
  return toBaseRoomName(name).toLowerCase().replace(/\s+/g, ' ').trim();
}

// check if the name ends with "copy", "copy 1", "copy 2" (case-insensitive) to determine if it's a copy name
function isCopyName(name: string): boolean {
  return /\s+copy(?:\s+\d+)?$/i.test(name.trim());
}

// retrieve the room number from the userMessage
function extractRequestedRoomNumber(message: string): number | null {
  const m = message.toLowerCase().match(/\b(?:room|kamer)\s+(\d+)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// retrive the copy count from the userMessage
function extractCopyCount(message: string): number {
  // lowercase for matching
  const lower = message.toLowerCase();

  // patern 1: number after the room number: "room 1 copy 3 times", "kamer 2
  const trailingCount = lower.match(/\b(?:room|kamer)\s+\d+\s+(\d+)\s*(?:times?|keer)\b/);
  if (trailingCount) {
    const n = Number(trailingCount[1]);
    return Number.isFinite(n) ? Math.max(1, Math.min(50, n)) : 1; // max 50 copies
  }

  // patern 2: number comes before the copy keyword: "copy room 1 3 times", "copy 2 of room 2", "duplicate room 3 4 times"
  const leadingCount = lower.match(/\b(\d+)\s*(?:copies?|kopie(?:e|ë)?n?)\b/);
  if (leadingCount) {
    const n = Number(leadingCount[1]);
    return Number.isFinite(n) ? Math.max(1, Math.min(50, n)) : 1;
  }

  // default copy count is 1
  return 1;
}


function getNextCopyIndex(baseRoomName: string, rooms: Room[]): number {
  // Escape special regex characters in the base room name
  const escaped = baseRoomName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Build a regex to match "Room 1 Copy 1", "Room 1 Copy 2", etc., and retrieve the copy number
  const rx = new RegExp(`^${escaped}\\s+Copy(?:\\s+(\\d+))?$`, 'i');
  let max = 0;

  // Go through all rooms and find the highest copy number 
  for (const r of rooms) {
    const m = r.name.match(rx); // does the room name match

    if (!m) continue; // if not, skip
    
    const n = m[1] ? Number(m[1]) : 1; // get the copy number, default is 1

    if (Number.isFinite(n)) max = Math.max(max, n); // update max if this copy number is higher than the current max
  }

  return max + 1; // next copy index is max + 1
}
