// tool schemas that define what functions the AI can call
// the AI reads these descriptions to decide which function to use
export const tools = [
  {
    type: "function",
    function: {
      name: "create_room",
      description: "Maak een nieuwe kamer aan op de plattegrond",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Naam van de kamer" },
          width: { type: "number", description: "Breedte in meters" },
          height: { type: "number", description: "Hoogte in meters" }
        },
        required: ["name", "width", "height"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "copy_room",
      description: "Kopieer een bestaande kamer een aantal keer",
      parameters: {
        type: "object",
        properties: {
          room: { type: "string", description: "Naam van de kamer om te kopieren" },
          copies: { type: "number", description: "Aantal kopieen" }
        },
        required: ["room", "copies"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "add_furniture",
      description: "Plaats een meubel in een kamer",
      parameters: {
        type: "object",
        properties: {
          catalogId: { type: "string", description: "Exacte catalogId van het meubel. Geldige waarden: bed_queen (bed), sofa (bank), coffee_table (salontafel), tv_stand (tv meubel), desk (bureau), office_chair (bureaustoel), wardrobe (kast), nightstand (nachtkastje), bookshelf (boekenkast), dining_table (eettafel), dining_chair (eetstoel), stove (fornuis), fridge (koelkast), counter (aanrecht), toilet (toilet), bathtub (bad), sink_b (wastafel)" },
          room: { type: "string", description: "Naam van de kamer" },
          position: { type: "string", description: "Positie: boven, onder, links, rechts, midden" }
        },
        required: ["catalogId", "room", "position"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "add_door",
      description: "Plaats een deur op een muur van een kamer",
      parameters: {
        type: "object",
        properties: {
          room: { type: "string", description: "Naam van de kamer" },
          wall: { type: "string", description: "Welke muur: boven, onder, links, rechts" },
          doorType: { type: "string", description: "Type deur: single, double, sliding, french, pocket, bifold" }
        },
        required: ["room", "wall", "doorType"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "add_window",
      description: "Plaats een raam op een muur van een kamer",
      parameters: {
        type: "object",
        properties: {
          room: { type: "string", description: "Naam van de kamer" },
          wall: { type: "string", description: "Welke muur: boven, onder, links, rechts" },
          windowType: { type: "string", description: "Type raam: standard, fixed, casement, sliding, bay" }
        },
        required: ["room", "wall", "windowType"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "add_stairs",
      description: "Plaats een trap in een kamer",
      parameters: {
        type: "object",
        properties: {
          room: { type: "string", description: "Naam van de kamer" },
          stairsType: { type: "string", description: "Type trap: straight, l-shaped, u-shaped, spiral" },
          position: { type: "string", description: "Positie: boven, onder, links, rechts, midden" }
        },
        required: ["room", "stairsType", "position"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "label_room",
      description: "Verander de naam van een kamer",
      parameters: {
        type: "object",
        properties: {
          currentName: { type: "string", description: "Huidige naam van de kamer" },
          newName: { type: "string", description: "Nieuwe naam voor de kamer" }
        },
        required: ["currentName", "newName"]
      }
    }
  }
];