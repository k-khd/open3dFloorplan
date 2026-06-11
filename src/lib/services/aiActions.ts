// AI action registry — single source of truth for both the tool schemas the model
// sees AND the execution. Each handler only RESOLVES arguments and then calls the
// existing editor functions in project.ts (which run through mutate() so undo works).
// No mutation logic is duplicated here.

import { addFurniture, addDoor, addWindow, addStair, removeElement, rotateFurniture, updateFurniture, updateRoom, createRoom, resizeRoom, copyRoom } from '$lib/stores/project';
import type { Door, Window as Win } from '$lib/models/types';
import { getActiveFloor, resolveRoom, resolveWall, roomBounds, positionInRoom, rotationForDirection, resolveFurnitureInRoom } from './aiResolvers';

const M = 100; // 1 meter = 100 cm

interface ActionDef {
  schema: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  run: (args: any) => string;
}

export const actions: Record<string, ActionDef> = {
  // create_room for creating a new room from scratch, the AI needs to provide a name and dimensions for the room
  create_room: {
    schema: {
      name: 'create_room',
      description: 'Maak een nieuwe kamer aan met een breedte en hoogte in meters. Voorbeeld: "5 bij 4" betekent width 5, height 4.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Naam van de kamer' },
          width: { type: 'number', description: 'Breedte in meters' },
          height: { type: 'number', description: 'Hoogte in meters' },
        },
        required: ['name', 'width', 'height'],
      },
    },
    run: (a) => {
      createRoom(a.name, a.width * M, a.height * M);
      return `${a.name} aangemaakt (${a.width}x${a.height}m).`;
    },
  },

  // copy_room for copying an existing room a number of times, the AI needs to provide the name of the room to copy and how many copies to make
  copy_room: {
    schema: {
      name: 'copy_room',
      description: 'Kopieer een bestaande kamer een aantal keer. De kopieen komen rechts naast de bestaande kamers te staan, inclusief meubels, deuren en ramen.',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: 'Naam van de kamer om te kopieren' },
          copies: { type: 'number', description: 'Aantal kopieen (standaard 1)' },
        },
        required: ['room'],
      },
    },
    run: (a) => {
      const floor = getActiveFloor();
      if (!floor) return 'Geen actieve verdieping.';
      const room = resolveRoom(floor, a.room);
      if (!room) return `Kamer "${a.room}" niet gevonden.`;
      const copies = Math.max(1, Math.round(a.copies ?? 1));
      copyRoom(room.id, copies);
      return `${room.name} ${copies}x gekopieerd.`;
    },
  },

  // rezize_room for changing the dimensions of an existing room, the AI needs to provide the name of the room and the new width and/or height in meters
  resize_room: {
    schema: {
      name: 'resize_room',
      description: 'Verander de afmeting van een bestaande kamer. Geef breedte en/of hoogte in meters.',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: 'Naam van de kamer' },
          width: { type: 'number', description: 'Nieuwe breedte in meters (optioneel)' },
          height: { type: 'number', description: 'Nieuwe hoogte in meters (optioneel)' },
        },
        required: ['room'],
      },
    },
    run: (a) => {
      const floor = getActiveFloor();
      if (!floor) return 'Geen actieve verdieping.';
      const room = resolveRoom(floor, a.room);
      if (!room) return `Kamer "${a.room}" niet gevonden.`;
      if (!a.width && !a.height) return 'Geef een nieuwe breedte of hoogte op.';
      resizeRoom(room.id, a.width ? a.width * M : undefined, a.height ? a.height * M : undefined);
      return `${room.name} aangepast naar ${a.width ?? '?'}x${a.height ?? '?'}m.`;
    },
  },

  // label_room for renaming an existing room, the AI needs to provide the current name of the room and the new name
  label_room: {
    schema: {
      name: 'label_room',
      description: 'Hernoem een bestaande kamer.',
      parameters: {
        type: 'object',
        properties: {
          currentName: { type: 'string', description: 'Huidige naam van de kamer' },
          newName: { type: 'string', description: 'Nieuwe naam voor de kamer' },
        },
        required: ['currentName', 'newName'],
      },
    },
    run: (a) => {
      const floor = getActiveFloor();
      if (!floor) return 'Geen actieve verdieping.';
      const room = resolveRoom(floor, a.currentName);
      if (!room) return `Kamer "${a.currentName}" niet gevonden.`;
      updateRoom(room.id, { name: a.newName });
      return `Kamer hernoemd naar "${a.newName}".`;
    },
  },

  // add_element for placing a new element in a room, the AI needs to provide the type of element (furniture, door, window or stairs), the name of the room, and additional details depending on the type
  add_element: {
    schema: {
      name: 'add_element',
      description: 'Plaats een element in een kamer: een meubel, deur, raam of trap.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['furniture', 'door', 'window', 'stairs'], description: 'Soort element' },
          room: { type: 'string', description: 'Naam van de kamer' },
          catalogId: { type: 'string', description: 'Alleen bij furniture. Geldige waarden o.a.: bed_queen, sofa, coffee_table, tv_stand, desk, office_chair, wardrobe, nightstand, bookshelf, dining_table, dining_chair, stove, fridge, counter, toilet, bathtub, sink_b' },
          subtype: { type: 'string', description: 'Deur: single/double/sliding/french/pocket/bifold. Raam: standard/fixed/casement/sliding/bay. Trap: straight/l-shaped/u-shaped/spiral' },
          position: { type: 'string', description: 'boven, onder, links, rechts of midden' },
        },
        required: ['type', 'room'],
      },
    },
    run: (a) => {
      const floor = getActiveFloor();
      if (!floor) return 'Geen actieve verdieping.';
      const room = resolveRoom(floor, a.room);
      if (!room) return `Kamer "${a.room}" niet gevonden.`;
      const b = roomBounds(floor, room);

      switch (a.type) {
        case 'furniture': {
          if (!a.catalogId) return 'Geen meubel (catalogId) opgegeven.';
          const pos = positionInRoom(b, a.position);
          const id = addFurniture(a.catalogId, pos);
          const rot = rotationForDirection(a.position);
          if (rot) updateFurniture(id, { rotation: rot });
          return `${a.catalogId} geplaatst in ${room.name}.`;
        }
        case 'door': {
          const wall = resolveWall(floor, room, a.position ?? 'onder');
          if (!wall) return `Muur "${a.position ?? 'onder'}" niet gevonden in ${room.name}.`;
          addDoor(wall.id, 0.5, (a.subtype ?? 'single') as Door['type']);
          return `${a.subtype ?? 'single'} deur geplaatst op de ${a.position ?? 'onder'}-muur van ${room.name}.`;
        }
        case 'window': {
          const wall = resolveWall(floor, room, a.position ?? 'boven');
          if (!wall) return `Muur "${a.position ?? 'boven'}" niet gevonden in ${room.name}.`;
          addWindow(wall.id, 0.5, (a.subtype ?? 'standard') as Win['type']);
          return `${a.subtype ?? 'standard'} raam geplaatst op de ${a.position ?? 'boven'}-muur van ${room.name}.`;
        }
        case 'stairs': {
          const pos = positionInRoom(b, a.position);
          addStair(pos);
          return `Trap geplaatst in ${room.name}.`;
        }
        default:
          return `Onbekend elementtype: ${a.type}`;
      }
    },
  },

  // delete_element for removing an existing furniture item from a room, the AI needs to provide the name of the room and a keyword to identify the target furniture (e.g. "bank" or "bed")
  delete_element: {
    schema: {
      name: 'delete_element',
      description: 'Verwijder een meubel uit een kamer op basis van een trefwoord.',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: 'Naam van de kamer' },
          target: { type: 'string', description: 'Trefwoord van het meubel, bv. "bank", "bed", "bureau"' },
        },
        required: ['room', 'target'],
      },
    },
    run: (a) => {
      const floor = getActiveFloor();
      if (!floor) return 'Geen actieve verdieping.';
      const room = resolveRoom(floor, a.room);
      if (!room) return `Kamer "${a.room}" niet gevonden.`;
      const item = resolveFurnitureInRoom(floor, room, a.target);
      if (!item) return `Geen "${a.target}" gevonden in ${room.name}.`;
      removeElement(item.id);
      return `${a.target} verwijderd uit ${room.name}.`;
    },
  },

  // update_element for changing an existing furniture item in a room, the AI needs to provide the name of the room, a keyword to identify the target furniture and what to change about it (rotate and/or move)
  update_element: {
    schema: {
      name: 'update_element',
      description: 'Pas een bestaand meubel aan: roteren en/of verplaatsen binnen de kamer.',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: 'Naam van de kamer' },
          target: { type: 'string', description: 'Trefwoord van het meubel, bijv. "bank", "bed"' },
          rotate: { type: 'number', description: 'Aantal graden om te draaien, bv. 90' },
          moveTo: { type: 'string', description: 'Nieuwe positie: boven, onder, links, rechts of midden' },
        },
        required: ['room', 'target'],
      },
    },
    run: (a) => {
      const floor = getActiveFloor();
      if (!floor) return 'Geen actieve verdieping.';
      const room = resolveRoom(floor, a.room);
      if (!room) return `Kamer "${a.room}" niet gevonden.`;
      const item = resolveFurnitureInRoom(floor, room, a.target);
      if (!item) return `Geen "${a.target}" gevonden in ${room.name}.`;

      let changed = false;
      if (typeof a.rotate === 'number' && a.rotate !== 0) {
        rotateFurniture(item.id, a.rotate);
        changed = true;
      }
      if (a.moveTo) {
        const pos = positionInRoom(roomBounds(floor, room), a.moveTo);
        updateFurniture(item.id, { position: pos });
        changed = true;
      }
      return changed ? `${a.target} aangepast in ${room.name}.` : 'Niets om aan te passen opgegeven.';
    },
  },
};

// Tool list for Ollama — generated from the registry so schema & execution never drift.
export const tools = Object.values(actions).map((a) => ({ type: 'function', function: a.schema }));

/** Execute one tool call coming back from the model. */
export function executeAction(toolCall: any): string {
  const def = actions[toolCall?.function?.name];
  if (!def) return `Onbekende actie: ${toolCall?.function?.name}`;
  let args = toolCall.function.arguments;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { args = {}; }
  }
  return def.run(args ?? {});
}
