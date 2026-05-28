import type { Door, Room, Wall } from '$lib/models/types';

// generate a random 8 character string for new ID's (for walls, rooms, doors, furniture)
const generateId = () => Math.random().toString(36).substring(2, 10);

// function receives a project and a list of actions from the AI, executes them and returns true if any action was executed successfully
export function executeActionPlan(project: any, actionPlan: any[]): boolean {

  // search for the active floor in the project
  const floor = project.floors.find((f: any) => f.id === project.activeFloorId);
  if (!floor || !floor.rooms || floor.rooms.length === 0) return false;


  // get the far right x coordinates of all existing walls to know where to place copied rooms without overlap
  const getFarRightX = () => {
    let maxX = 0;
    floor.walls.forEach((w: any) => {
      maxX = Math.max(maxX, w.start.x, w.end.x);
    });
    return maxX + 200;
  };


  const getRoomBounds = (room: any) => {
    const roomWalls = floor.walls.filter((w: any) => (room.walls || room.wallIds || []).includes(w.id));
    if (roomWalls.length === 0) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    roomWalls.forEach((w: any) => {
      minX = Math.min(minX, w.start.x, w.end.x);
      maxX = Math.max(maxX, w.start.x, w.end.x);
      minY = Math.min(minY, w.start.y, w.end.y);
      maxY = Math.max(maxY, w.start.y, w.end.y);
    });
    return { minX, maxX, minY, maxY, width: maxX - minX, length: maxY - minY };
  };

  let actionExecuted = false;

  for (const action of actionPlan) {
    if (action.action === "copy_room") {

      // search for the room that matches the target name
      let targetName = (action.targetRoomName || "").toLowerCase().trim();
      
      let originalRoom = floor.rooms.find((r: any) => {
        const canvasName = r.name.toLowerCase().trim();
        return canvasName === targetName || canvasName.includes(targetName) || targetName.includes(canvasName);
      });

      if (!originalRoom) continue;


      // get the walls of the original room
      const originalWalls = floor.walls.filter((w: any) => (originalRoom.walls || originalRoom.wallIds || []).includes(w.id));
      const bounds = getRoomBounds(originalRoom);
      if (!bounds || originalWalls.length === 0) continue;

      // search for all furniture in the original room, check if the position is within the room bounds
      const originalFurniture = (floor.furniture || []).filter((f: any) =>
        f.position.x >= bounds.minX && f.position.x <= bounds.maxX &&
        f.position.y >= bounds.minY && f.position.y <= bounds.maxY
      );

      // start copying and modifying the room based on the action details, copy starts right of the original room
      let startX = getFarRightX();
      const copies = action.copies || 1;
      const modifications = action.modifications || [];

      // each copy starts at number 1 
      for (let i = 0; i < copies; i++) {
        const copyNumber = i + 1;


        let scaleX = 1;
        let scaleY = 1;
        let targetW = bounds.width;
        let targetL = bounds.length;

        
        const resizeMod = modifications.find((m: any) =>
          (m.applyToCopy === copyNumber || m.applyToCopy === "all") && m.type === "resize"
        );
        if (resizeMod) {
          targetW = resizeMod.newWidthUnits || bounds.width;
          targetL = resizeMod.newLengthUnits || bounds.length;
          scaleX = targetW / bounds.width;
          scaleY = targetL / bounds.length;
        }

        const offsetX = startX - bounds.minX;
        

        // for each original wall, make a copy with a new ID. wallIdMap remembers which old ID belongs to the new ID (for copying doors and windows)
        const newWallIds: string[] = [];
        const wallIdMap: Record<string, string> = {};

        originalWalls.forEach((ow: any) => {
          const nw = JSON.parse(JSON.stringify(ow));
          nw.id = generateId();

          wallIdMap[ow.id] = nw.id;

          nw.start.x = bounds.minX + ((ow.start.x - bounds.minX) * scaleX) + offsetX;
          nw.start.y = bounds.minY + ((ow.start.y - bounds.minY) * scaleY);
          nw.end.x = bounds.minX + ((ow.end.x - bounds.minX) * scaleX) + offsetX;
          nw.end.y = bounds.minY + ((ow.end.y - bounds.minY) * scaleY);
          
          if (nw.curvePoint) {
            nw.curvePoint.x = bounds.minX + ((nw.curvePoint.x - bounds.minX) * scaleX) + offsetX;
            nw.curvePoint.y = bounds.minY + ((nw.curvePoint.y - bounds.minY) * scaleY);
          }
          
          floor.walls.push(nw);
          newWallIds.push(nw.id);
        });

        // look for existing doors on the original walls, copy them and update the wallId to the new wall
        if (!floor.doors) floor.doors = [];
        const originalDoors = (floor.doors || []).filter((d: any) => originalWalls.some((ow: any) => ow.id === d.wallId));
        
        originalDoors.forEach((od: any) => {
          const nd = JSON.parse(JSON.stringify(od));
          nd.id = generateId();
          nd.wallId = wallIdMap[od.wallId]; // replace old wall id with new wall id
          floor.doors.push(nd);
        });

       // look for existing windows on the original walls, copy them and update the wallId to the new wall
        if (!floor.windows) floor.windows = [];
        const originalWindows = (floor.windows || []).filter((w: any) => originalWalls.some((ow: any) => ow.id === w.wallId));
        
        originalWindows.forEach((ow: any) => {
          const nw = JSON.parse(JSON.stringify(ow));
          nw.id = generateId();
          nw.wallId = wallIdMap[ow.wallId]; // replace old wall id with new wall id
          floor.windows.push(nw);
        });

        const newRoomName = `${originalRoom.name} (Kopie ${copyNumber})`;
        // create the room object with the new wall IDs, new name and same floor texture, add it to the floor.rooms array
        floor.rooms.push({
          id: generateId(),
          name: newRoomName,
          walls: newWallIds,
          floorTexture: originalRoom.floorTexture
        });

        if (!floor.furniture) floor.furniture = [];

        // for each furniture item: is there a remove modification? if yes don't copy this item
        if (originalFurniture.length > 0) {
          originalFurniture.forEach((f: any) => {
            const removeMod = modifications.find((m: any) => {
              if ((m.applyToCopy !== copyNumber && m.applyToCopy !== "all") || m.type !== "remove_furniture") return false;
              const targetWords = String(m.catalogId || "").toLowerCase().split(/[\s_]+/);
              const itemWords = String(f.catalogId || "").toLowerCase().split(/[\s_]+/);
              return targetWords.some(word => itemWords.includes(word) && word.length > 2);
            });

            // if not, copy it
            if (!removeMod) {
              const newFurniture = JSON.parse(JSON.stringify(f));
              newFurniture.id = generateId();
              newFurniture.position.x = bounds.minX + ((f.position.x - bounds.minX) * scaleX) + offsetX;
              newFurniture.position.y = bounds.minY + ((f.position.y - bounds.minY) * scaleY);
              floor.furniture.push(newFurniture);
            }
          });
        }

        // if there are add furniture modifications, add them standard in the middle, only small positional adjustments can be made so far
        const addMods = modifications.filter((m: any) =>
          (m.applyToCopy === copyNumber || m.applyToCopy === "all") && m.type === "add_furniture"
        );
        addMods.forEach((m: any) => {
          let posX = startX + (targetW / 2);
          let posY = bounds.minY + (targetL / 2);
          if (m.position === "left") posX = startX + 50;
          if (m.position === "right") posX = startX + targetW - 50;
          if (m.position === "top") posY = bounds.minY + 50;
          if (m.position === "bottom") posY = bounds.minY + targetL - 50;

          floor.furniture.push({ id: generateId(), catalogId: m.catalogId, position: { x: posX, y: posY }, rotation: 0, scale: { x: 1, y: 1, z: 1 } });
        });

        // 2 meter gap between copies to avoid overlap
        startX += targetW + 200;
      }
      actionExecuted = true;
    }
  }

  return actionExecuted;
}