import type { Door, Room, Wall } from '$lib/models/types';

const generateId = () => Math.random().toString(36).substring(2, 10);

export function executeActionPlan(project: any, actionPlan: any[]): boolean {
  const floor = project.floors.find((f: any) => f.id === project.activeFloorId);
  if (!floor || !floor.rooms || floor.rooms.length === 0) return false;

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
      let targetName = (action.targetRoomName || "").toLowerCase().trim();
      
      let originalRoom = floor.rooms.find((r: any) => {
        const canvasName = r.name.toLowerCase().trim();
        return canvasName === targetName || canvasName.includes(targetName) || targetName.includes(canvasName);
      });

      if (!originalRoom) continue;

      const originalWalls = floor.walls.filter((w: any) => (originalRoom.walls || originalRoom.wallIds || []).includes(w.id));
      const bounds = getRoomBounds(originalRoom);
      if (!bounds || originalWalls.length === 0) continue;

      const originalFurniture = (floor.furniture || []).filter((f: any) =>
        f.position.x >= bounds.minX && f.position.x <= bounds.maxX &&
        f.position.y >= bounds.minY && f.position.y <= bounds.maxY
      );

      let startX = getFarRightX();
      const copies = action.copies || 1;
      const modifications = action.modifications || [];

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
        const newWallIds: string[] = [];

        originalWalls.forEach((ow: any) => {
          const nw = JSON.parse(JSON.stringify(ow));
          nw.id = generateId();
          
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

        const newRoomName = `${originalRoom.name} (Kopie ${copyNumber})`;
        floor.rooms.push({
          id: generateId(),
          name: newRoomName,
          walls: newWallIds,
          floorTexture: originalRoom.floorTexture
        });

        if (!floor.furniture) floor.furniture = [];

        
        if (originalFurniture.length > 0) {
          originalFurniture.forEach((f: any) => {
            const removeMod = modifications.find((m: any) => {
              if ((m.applyToCopy !== copyNumber && m.applyToCopy !== "all") || m.type !== "remove_furniture") return false;
              const targetWords = String(m.catalogId || "").toLowerCase().split(/[\s_]+/);
              const itemWords = String(f.catalogId || "").toLowerCase().split(/[\s_]+/);
              return targetWords.some(word => itemWords.includes(word) && word.length > 2);
            });

            if (!removeMod) {
              const newFurniture = JSON.parse(JSON.stringify(f));
              newFurniture.id = generateId();
              newFurniture.position.x = bounds.minX + ((f.position.x - bounds.minX) * scaleX) + offsetX;
              newFurniture.position.y = bounds.minY + ((f.position.y - bounds.minY) * scaleY);
              floor.furniture.push(newFurniture);
            }
          });
        }

        
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

        startX += targetW + 200;
      }
      actionExecuted = true;
    }
  }

  return actionExecuted;
}