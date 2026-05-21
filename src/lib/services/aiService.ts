import { get } from 'svelte/store';
import { currentProject, loadProject } from '$lib/stores/project';
import { executeActionPlan } from '$lib/services/roomCopyService';

export async function askAI(userMessage: string) {
  const project = get(currentProject);
  if (!project) return 'No project loaded.';

  const floor = project.floors.find(f => f.id === project.activeFloorId);
  if (!floor) return 'No active floor loaded.';

  const roomSummary = floor.rooms.map(r => r.name);

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
        format: "json",
        num_predict: 2048,
        messages: [{ role: "user", content: prompt }],
        stream: false,
      })
    });

    const data = await response.json();
    let rawContent = data.message.content.trim();
    let actionPlan: any[] = [];

    try {
      const parsed = JSON.parse(rawContent);
      if (Array.isArray(parsed)) {
        actionPlan = parsed;
      } else if (parsed && typeof parsed === 'object') {
        if ('actions' in parsed && Array.isArray(parsed.actions)) {
          actionPlan = parsed.actions;
        } else {
          actionPlan = [parsed];
        }
      }
    } catch (e) {
      console.error("AI JSON Parse Error:", rawContent);
      return "De AI stuurde een onleesbaar antwoord.";
    }

    console.log("DEBUG: AI Genest Actieplan:", actionPlan);

    const updatedProject = { ...project };
    const success = executeActionPlan(updatedProject, actionPlan);
    
    if (success) {
      loadProject(updatedProject);
      return `Instructies succesvol uitgevoerd!`;
    } else {
      return "Actie geannuleerd: kon de doelkamer niet vinden op het canvas.";
    }
  } catch (error) {
    console.error("Fetch error:", error);
    return "Fout bij verbinden met Ollama.";
  }
}