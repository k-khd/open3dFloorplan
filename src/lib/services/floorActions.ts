import { detectRooms } from '$lib/utils/roomDetection';
import { detectedRoomsStore } from '$lib/stores/project';


const generateId = () => Math.random().toString(36).substring(2, 10);

// finds which wall matches a direction (boven/onder/links/rechts) within a room
function findWallByDirection(roomWalls: any[], direction: string): any {
  const allY = roomWalls.map((rw: any) => [rw.start.y, rw.end.y]).flat();
  const allX = roomWalls.map((rw: any) => [rw.start.x, rw.end.x]).flat();

  for (const w of roomWalls) {
    const isHorizontal = w.start.y === w.end.y;
    const isVertical = w.start.x === w.end.x;
    if (direction === "boven" && isHorizontal && w.start.y === Math.min(...allY)) return w;
    if (direction === "onder" && isHorizontal && w.start.y === Math.max(...allY)) return w;
    if (direction === "rechts" && isVertical && w.start.x === Math.max(...allX)) return w;
    if (direction === "links" && isVertical && w.start.x === Math.min(...allX)) return w;
  }
  return null;
}

// calculates the bounding box and center point of a set of walls
function getRoomBounds(roomWalls: any[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const w of roomWalls) {
    // left
    minX = Math.min(minX, w.start.x, w.end.x);
    // right
    maxX = Math.max(maxX, w.start.x, w.end.x);
    // top
    minY = Math.min(minY, w.start.y, w.end.y);
    // bottom
    maxY = Math.max(maxY, w.start.y, w.end.y);
  }
  return { minX, maxX, minY, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}

// converts a direction string to x,y coordinates within a room's bounds
function getPositionFromDirection(bounds: any, direction: string) {
  switch (direction) {
    case "boven": return { x: bounds.centerX, y: bounds.minY + 50 };
    case "onder": return { x: bounds.centerX, y: bounds.maxY - 50 };
    case "rechts": return { x: bounds.maxX - 50, y: bounds.centerY };
    case "links": return { x: bounds.minX + 50, y: bounds.centerY };
    case "midden": return { x: bounds.centerX, y: bounds.centerY };
    default: return { x: bounds.centerX, y: bounds.centerY };
  }
}

// finds the rightmost x coordinate on the floor, used to place new rooms next to existing ones
function getRightmostX(floor: any): number {
  let startX = 0;
  for (const wall of floor.walls) {
    startX = Math.max(startX, wall.start.x, wall.end.x);
  }
  return startX;
}

// refreshes room labels on the canvas after any floor change
// needed because the canvas caches detected rooms and won't re-read names otherwise
export function refreshRoomLabels(floor: any): void {
  // match detected rooms with floor.rooms by wall IDs to restore names
  const freshRooms = detectRooms(floor.walls);
  freshRooms.forEach((detected: any) => {
    const match = floor.rooms.find((r: any) =>
      JSON.stringify([...r.walls].sort()) === JSON.stringify([...detected.walls].sort())
    );
    if (match) detected.name = match.name;
  });
  detectedRoomsStore.set(freshRooms);
}

// executes one tool call from the AI on the floor data
export function executeAction(floor: any, toolCall: any): string {
  const name = toolCall.function.name;
  const args = toolCall.function.arguments;

  switch (name) {

    // creates a new room based on AI provided name and dimensions, places it to the right of existing rooms
    case "create_room": {
      // Ai provides dimensions in meters, convert to cm for our data model  
      const w = args.width * 100;
      const h = args.height * 100;

      let startX = getRightmostX(floor);
      if (floor.walls.length > 0) startX += 200; // 2 meter gap between rooms

      // create 4 walls for the new room based on the provided dimensions
      const wallN = { id: generateId(), start: { x: startX, y: 0 }, end: { x: startX + w, y: 0 }, thickness: 15, height: 280, color: "#444444" };
      const wallE = { id: generateId(), start: { x: startX + w, y: 0 }, end: { x: startX + w, y: h }, thickness: 15, height: 280, color: "#444444" };
      const wallS = { id: generateId(), start: { x: startX + w, y: h }, end: { x: startX, y: h }, thickness: 15, height: 280, color: "#444444" };
      const wallW = { id: generateId(), start: { x: startX, y: h }, end: { x: startX, y: 0 }, thickness: 15, height: 280, color: "#444444" };

      floor.walls.push(wallN, wallE, wallS, wallW);

      // create a new room object
      floor.rooms.push({
        id: generateId(),
        name: args.name,
        walls: [wallN.id, wallE.id, wallS.id, wallW.id],
        floorTexture: "hardwood",
        area: args.width * args.height
      });
      return `${args.name} aangemaakt met de afmeting (${args.width}x${args.height}m).`;
    }

    // copies an existing room based on AI provided name and number of copies, places the copies to the right of existing rooms
    case "copy_room": {
      // search for the room to copy based on the provided name, get its walls and dimensions
      const sourceRoom = floor.rooms.find((r: any) => r.name.toLowerCase() === args.room.toLowerCase());
      if (!sourceRoom) return `Kamer "${args.room}" niet gevonden.`;
      const sourceWalls = floor.walls.filter((w: any) => sourceRoom.walls.includes(w.id));
      if (sourceWalls.length === 0) return `Geen muren gevonden voor "${args.room}".`;

      // used to calculate how far each copy needs to shift
      const minX = Math.min(...sourceWalls.map((w: any) => Math.min(w.start.x, w.end.x)));

      // snapshot original items before the loop so we don't copy copies
      const sourceWallIds = sourceRoom.walls;
      const originalDoors = [...floor.doors];
      const originalWindows = [...floor.windows];
      const originalFurniture = [...floor.furniture];
      const originalStairs = [...floor.stairs];
      const sourceBounds = getRoomBounds(sourceWalls);

      // each copy gets placed to the right of the previous one with a 2 meter gap in between
      for (let i = 0; i < (args.copies || 1); i++) {
        let startX = getRightmostX(floor);
        startX += 200;
        const offsetX = startX - minX;

        // Copy walls with new IDs and shifted positions, keep all other properties the same
        const newWalls = sourceWalls.map((w: any) => ({
          id: generateId(),
          start: { x: w.start.x + offsetX, y: w.start.y },
          end: { x: w.end.x + offsetX, y: w.end.y },
          thickness: w.thickness,
          height: w.height,
          color: w.color
        }));

        floor.walls.push(...newWalls);
        floor.rooms.push({
          id: generateId(),
          name: `${sourceRoom.name} (Kopie ${i + 1})`, // add (Kopie) to the name to distinguish from the original
          walls: newWalls.map((w: any) => w.id),
          floorTexture: sourceRoom.floorTexture,
          area: sourceRoom.area
        });
        
        // copy doors that belong to this room's walls
        for (const door of originalDoors) {
          if (sourceWallIds.includes(door.wallId)) {
            const oldWallIndex = sourceWallIds.indexOf(door.wallId);
            floor.doors.push({
              ...door,
              id: generateId(),
              wallId: newWalls[oldWallIndex].id
            });
          }
        }

        // copy windows that belong to this room's walls
        for (const window of originalWindows) {
          if (sourceWallIds.includes(window.wallId)) {
            const oldWallIndex = sourceWallIds.indexOf(window.wallId);
            floor.windows.push({
              ...window,
              id: generateId(),
              wallId: newWalls[oldWallIndex].id
            });
          }
        }

        // copy furniture inside this room
        for (const item of originalFurniture) {
          if (item.position.x >= sourceBounds.minX && item.position.x <= sourceBounds.maxX &&
              item.position.y >= sourceBounds.minY && item.position.y <= sourceBounds.maxY) {
            floor.furniture.push({
              ...item,
              id: generateId(),
              position: { x: item.position.x + offsetX, y: item.position.y }
            });
          }
        }

         // copy stairs that belong to this room
        for (const stair of originalStairs) {
          if (stair.position.x >= sourceBounds.minX && stair.position.x <= sourceBounds.maxX &&
              stair.position.y >= sourceBounds.minY && stair.position.y <= sourceBounds.maxY) {
            floor.stairs.push({
              ...stair,
              id: generateId(),
              position: { x: stair.position.x + offsetX, y: stair.position.y }
            });
          }
        }

      }
      return `${args.room} ${args.copies}x gekopieerd.`;
    }

    // adds furniture to a room based on AI provided catalogId, room name and position within the room
    case "add_furniture": {
      // find the room based on the provided name, get its walls and dimensions
      const room = floor.rooms.find((r: any) => r.name.toLowerCase() === args.room.toLowerCase());
      if (!room) return `Kamer "${args.room}" niet gevonden.`;
      const roomWalls = floor.walls.filter((w: any) => room.walls.includes(w.id));
      if (roomWalls.length === 0) return `Geen muren gevonden voor "${args.room}".`;

      // calculate the position to place the furniture based on the provided direction and room dimensions
      const bounds = getRoomBounds(roomWalls);
      const pos = getPositionFromDirection(bounds, args.position);

      // create a new furniture object with a unique ID, the provided catalogId, calculated position and default rotation and scale
      floor.furniture.push({
        id: generateId(),
        catalogId: args.catalogId,
        position: { x: pos.x, y: pos.y },
        rotation: args.position === "links" ? 270 : args.position === "rechts" ? 90 : args.position === "onder" ? 180 : 0,
        scale: { x: 1, y: 1, z: 1 }
      });
      return `${args.catalogId} geplaatst in ${args.room}.`;
    }


    // adds a door to a wall based on AI provided room name, wall direction and door type
    case "add_door": {
      // find the room based on the provided name, get its walls and dimensions
      const room = floor.rooms.find((r: any) => r.name.toLowerCase() === args.room.toLowerCase());
      if (!room) return `Kamer "${args.room}" niet gevonden.`;
      const roomWalls = floor.walls.filter((w: any) => room.walls.includes(w.id));

      // find the target wall based on the provided direction, NO xand y coordinates are provided for doors and windows because they will be placed in the middle of the wall by default. 
      const targetWall = findWallByDirection(roomWalls, args.wall);
      if (!targetWall) return `Muur "${args.wall}" niet gevonden in ${args.room}.`;

      // create a new door object with a unique ID, the target wall ID, default position in the middle of the wall, default dimensions and the provided door type
      floor.doors.push({
        id: generateId(),
        wallId: targetWall.id,
        position: 0.5, // middle of the wall
        width: 80,
        height: 210,
        type: args.doorType || "single",
        swingDirection: "left",
        flipSide: false
      });
      return `${args.doorType || "single"} deur geplaatst op de ${args.wall} muur van ${args.room}.`;
    }


    // adds a window to a wall based on AI provided room name, wall direction and window type
    case "add_window": {
      // find the room based on the provided name, get its walls and dimensions
      const room = floor.rooms.find((r: any) => r.name.toLowerCase() === args.room.toLowerCase());
      if (!room) return `Kamer "${args.room}" niet gevonden.`;
      const roomWalls = floor.walls.filter((w: any) => room.walls.includes(w.id));

      //find the target wall based on the provided direction, NO xand y coordinates are provided for doors and windows because they will be placed in the middle of the wall by default.
      const targetWall = findWallByDirection(roomWalls, args.wall);
      if (!targetWall) return `Muur "${args.wall}" niet gevonden in ${args.room}.`;

      // create a new window object with a unique ID, the target wall ID, default position in the middle of the wall, default dimensions and the provided window type
      floor.windows.push({
        id: generateId(),
        wallId: targetWall.id,
        position: 0.5,
        width: 100,
        height: 120,
        sillHeight: 90,
        type: args.windowType || "standard"
      });
      return `${args.windowType || "standard"} raam geplaatst op de ${args.wall} muur van ${args.room}.`;
    }


    // adds a staircase to a room based on AI provided room name, stairs type and position within the room
    case "add_stairs": {
      // find the room based on the provided name, get its walls and dimensions
      const room = floor.rooms.find((r: any) => r.name.toLowerCase() === args.room.toLowerCase());
      if (!room) return `Kamer "${args.room}" niet gevonden.`;
      const roomWalls = floor.walls.filter((w: any) => room.walls.includes(w.id));

      // calculate the position to place the stairs based on the provided direction and room dimensions
      const bounds = getRoomBounds(roomWalls);
      const pos = getPositionFromDirection(bounds, args.position);

      // create a new stairs object with a unique ID, calculated position, default dimensions and the provided stairs type
      floor.stairs.push({
        id: generateId(),
        position: { x: pos.x, y: pos.y },
        rotation: 0,
        width: 100,
        depth: 300,
        riserCount: 14,
        direction: "up",
        stairType: args.stairsType || "straight"
      });
      return `${args.stairsType || "straight"} trap geplaatst in ${args.room}.`;
    }


    // changes the name of a room based on AI provided current name and new name
    case "label_room": {
      // find the room based on the provided current name and change it to the new name  
      const room = floor.rooms.find((r: any) => r.name.toLowerCase() === args.currentName.toLowerCase());
      if (!room) return `Kamer "${args.currentName}" niet gevonden.`;
      // change the name of the room to the new name provided by the AI
      room.name = args.newName;
      
      return `Kamer hernoemd van "${args.currentName}" naar "${args.newName}".`;
    }

    default:
      return `Onbekende actie: ${name}`;
  }
}