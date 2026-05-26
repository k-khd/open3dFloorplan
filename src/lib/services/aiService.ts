import { get } from 'svelte/store';
import { currentProject, loadProject } from '$lib/stores/project';
import { executeActionPlan } from '$lib/services/roomCopyService';
import { detectedRoomsStore } from '$lib/stores/project';

export async function askAI(userMessage: string) {
  // get current project and active floor details  
  const project = get(currentProject);
  if (!project) return 'No project loaded.';

  const floor = project.floors.find(f => f.id === project.activeFloorId);
  if (!floor) return 'No active floor loaded.';

  // Route: copy commands go to the action plan system, everything else to the old JSON-editing system
  const isCopyIntent = /\b(copy|copies|duplicate|dupliceer|kopieer|kopie[eë]n?|maak.*kopi)/i.test(userMessage);

  if (isCopyIntent) {
    return handleCopyAction(userMessage, project, floor);
  } else {
    return handleSimpleAction(userMessage, project, floor);
  }
}

// Copying rooms (with modifications): AI generates a small structured command, code executes it
async function handleCopyAction(userMessage: string, project: any, floor: any) {
  // make a list of only the room names
  const roomSummary = floor.rooms.map((r: any) => r.name);

  // specific prompt for AI. Prompt contains all avaivable rooms, available furniture id's and strict instructions for the JSON format
  const prompt = `
  Je bent de AI-engine voor een floorplanner app. 1 meter = 100 units.
  
  BELANGRIJK: SPIEK NIET. 
  Lees de vraag van de gebruiker ("${userMessage}") en vul ZELF de juiste getallen in. 
  Als de gebruiker 3 kopieën wil, gebruik je 3. Verzin géén acties die de gebruiker niet heeft gevraagd.

  STRIKTE NAAMGEVING REGEL:
  - Kamers NU op het canvas: ${JSON.stringify(roomSummary)}
  - "targetRoomName" MOET een naam uit deze lijst zijn. 
  - Kies ALTIJD de originele kamer (bijv. "woonkamer") en NIET een eerdere kopie (zoals "woonkamer (Kopie 1)"), tenzij de gebruiker specifiek om de kopie vraagt.

  BESCHIKBARE CATALOG ID's:
  sofa, loveseat, chair, coffee_table, tv_stand, bookshelf, side_table, fireplace, television, storage, table, bed_queen, bed_twin, nightstand, wardrobe, dresser, stove, fridge, sink_k, counter, dishwasher, oven, toilet, bathtub, shower, sink_b, washer_dryer, desk, office_chair, dining_table, dining_chair, rug, round_rug, potted_plant, floor_plant, ceiling_light

  SPECIALE REGEL VOOR "applyToCopy":
  - Wil de gebruiker een aanpassing in Kopie 1? Gebruik "applyToCopy": 1. Hetzelfde geldt voor Kopie 2, 3, etc.
  - Wil de gebruiker een aanpassing in ALLE kopieën (elke kamer)? Gebruik "applyToCopy": "all".  

  Genereer EXACT deze structuur (vul zelf in!):
  [
    { 
      "action": "copy_room",
      "targetRoomName": "Exacte_Naam",
      "copies": AANTAL_GEVRAAGD,
      "modifications": [
        { "applyToCopy": "all", "type": "remove_furniture", "catalogId": "GEVRAAGDE_ID" }
      ]
    }
  ]

  Geef ALLEEN de JSON array terug.
  `;

  try {
    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5-coder:7b",
        // AI will only return valid JSON
        format: "json",
        num_predict: 2048,
        messages: [{ role: "user", content: prompt }],
        stream: false,
      })
    });

    // AI reponse converted to JSON
    const data = await response.json();

    let rawContent = data.message.content.trim();
    let actionPlan: any[] = [];
    
    try {
      // Attempt to parse the AI response text into JavaScript object
      const parsed = JSON.parse(rawContent);
       // Option 1: AI returned a JSON array directly, use it
      if (Array.isArray(parsed)) {
        actionPlan = parsed;
      } else if (parsed && typeof parsed === 'object') {
        if ('actions' in parsed && Array.isArray(parsed.actions)) {
          // Option 2: AI returned an object with an "actions" array, unwrap it
          actionPlan = parsed.actions;
        } else {
          // Option 3: AI returned a single action object, that will be wrapped in an array
          actionPlan = [parsed];
        }
      }
    } catch (e) {
      console.error("AI JSON Parse Error:", rawContent);
      return "De AI stuurde een onleesbaar antwoord.";
    }

    console.log("DEBUG: AI Genest Actieplan:", actionPlan);

    // Create a copy of the project to apply changes
    const updatedProject = { ...project };

    // send the plan to roomCopyService 
    const success = executeActionPlan(updatedProject, actionPlan);
    if (success) {
      // if it worked, load the updated project so the editor shows the changes
      loadProject(updatedProject);
      return `Instructies succesvol uitgevoerd!`;
    } else {
      return "Actie geannuleerd: kon de kamer niet vinden op het canvas.";
    }

  } catch (error) {
    console.error("Fetch error:", error);
    return "Fout bij verbinden met Ollama.";
  }
}

// AI edits the full project JSON directly (for creating rooms, placing doors, simple tasks)
async function handleSimpleAction(userMessage: string, project: any, floor: any) {
  const detectedRooms = get(detectedRoomsStore);
  const allRooms = detectedRooms.length > 0 ? detectedRooms : floor.rooms;

  // Get all walls in active floor
  const wallsWithDescriptions = floor.walls.map((w: any) => {
    // if y starts and ends are the same, it's horizontal, otherwise vertical
    const isHorizontal = w.start.y === w.end.y;
    // Calculate mid points for potential use in room description
    return { ...w, isHorizontal, midX: (w.start.x + w.end.x) / 2, midY: (w.start.y + w.end.y) / 2 };
  });

  // For each room (r) in the list, do the following:
  const roomDescriptions = allRooms.map((r: any) => {
    // Find the full wall details for each wall ID in this room
   const roomWalls = (r.walls || []).map((wId: string) => wallsWithDescriptions.find((w: any) => w.id === wId)).filter(Boolean);
    // Keep only the horizontal walls (top and bottom)
    const horizontalWalls = roomWalls.filter((w: any) => w.isHorizontal);
    // Keep only the vertical walls (left and right)
    const verticalWalls = roomWalls.filter((w: any) => !w.isHorizontal);

    //create empty variables for wall position
    let topWall = '', bottomWall = '', leftWall = '', rightWall = '';

    // If there are at least 2 horizontal walls, sort them to find top and bottom
    if (horizontalWalls.length >= 2) {
      horizontalWalls.sort((a: any, b: any) => a.midY - b.midY);
      topWall = horizontalWalls[0].id;
      bottomWall = horizontalWalls[horizontalWalls.length - 1].id;
    }
    // If there are at least 2 vertical walls, sort them to find left and right
    if (verticalWalls.length >= 2) {
      verticalWalls.sort((a: any, b: any) => a.midX - b.midX);
      leftWall = verticalWalls[0].id;
      rightWall = verticalWalls[verticalWalls.length - 1].id;
    }

    // Return a simple object with room info and which wall is on which side
    return { id: r.id, name: r.name, topWall, bottomWall, leftWall, rightWall };
  });

  // Convert floorplan objects to JSON text to send to the AI
  const projectData = JSON.stringify({ rooms: roomDescriptions, doors: floor.doors, walls: floor.walls });

  // Example structures so the AI knows the correct format and doesn't make up the format
  const structures = `
  An example Door: {"id": "door-1", "wallId": "id-of-wall", "position": 0.5, "width": 90, "height": 210, "type": "single", "swingDirection": "left", "flipSide": false}
  An example Wall: {"id": "wall-1", "start": {"x": 0, "y": 0}, "end": {"x": 500, "y": 0}, "thickness": 15, "height": 280, "color": "#444444"}
  An example Room: {"id": "room-1", "name": "Bedroom", "walls": ["wall-1", "wall-2"], "floorTexture": "hardwood", "area": 12}
  `;

  // Send the project data to AI running locally
  try {
    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Stringify for fetch
      body: JSON.stringify({
        "model": "qwen2.5-coder:7b",
        "messages": [{
          "role": "user",
          "content": `You're an assistant for a 2D Floorplanner/3D model design tool.
          You will handle accoarding to the instructions based on ${userMessage} and the structure of objects: ${projectData}.
          When making changes, always respond with the complete JSON object containing walls, rooms, and doors arrays. Never return only a partial update. 
          Always check that the JSON structure is correct and if changes are needed, return the full updated JSON with all elements.
          When adding or changing rooms, doors or walls, make sure to keep the structure of the JSON the same and only change the parts that are needed.
          In this editor, 1 meter equals 100 units. The first number is wifth (x) and the second number is length (y).
          When needed, edit the JSON based on the structure defined by: ${structures}.`
        }],
        "stream": false,
      })
    });

    // Turning the string response into JSON
    const data = await response.json();

    // Getting text response from AI
    const content = data.message.content;
    console.log("AI Response:", content);

    // Check if the response contains json, filtered with { and }
    const jsonStart = content.indexOf('{');
    const jsonEnd = content.lastIndexOf('}');

    // if JSON is found in the response, extract it out
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      const jsonString = content.substring(jsonStart, jsonEnd + 1);

      // Parse jsonString to object
      const object = JSON.parse(jsonString);
      
      //copy the current project 
      const updatedProject = { ...project };
      // Find the active floor in the copy
      const activeFloor = updatedProject.floors.find((f: any) => f.id === updatedProject.activeFloorId);

      // Replace only the changed parts
      if (activeFloor) {
        if (object.walls) activeFloor.walls = object.walls;
        if (object.doors) activeFloor.doors = object.doors;
        if (object.rooms) activeFloor.rooms = object.rooms;
      }
    
      // Load the new updated project 
      loadProject(updatedProject);

      return "I've adjusted the floorplan according to your input";
    }

    // If no JSON was found, return the AI's text response
    return data.message.content || "Sorry, I couldn't generate a response at this time.";

  } catch (error) {
    return "An error occurred while communicating with the AI service.";
  }
}