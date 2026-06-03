import { get } from 'svelte/store';
import { currentProject, loadProject } from '$lib/stores/project';
import { tools } from './aiTools';
import { executeAction, refreshRoomLabels } from './floorActions';

export async function askAI(userMessage: string) {
  const project = get(currentProject);
  if (!project) return 'No project loaded.';

  const floor = project.floors.find(f => f.id === project.activeFloorId);
  if (!floor) return 'No active floor loaded.';

  try {
    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "granite4.1:3b", 
        messages: [{ role: "user", content: userMessage }],
        tools: tools,
        stream: false,
      })
    });

    const data = await response.json();
    console.log("AI Response:", JSON.stringify(data.message, null, 2));

    // if the AI called one or more tools, execute each action
    if (data.message?.tool_calls && data.message.tool_calls.length > 0) {
      const updatedProject = { ...project };
      const activeFloor = updatedProject.floors.find((f: any) => f.id === updatedProject.activeFloorId);
      if (!activeFloor) return 'No active floor.';

      let result = "";
      for (const toolCall of data.message.tool_calls) {
        result += executeAction(activeFloor, toolCall) + " ";
      }

      loadProject(updatedProject);
      refreshRoomLabels(activeFloor);
      return result.trim();
    }

    // if no tool was called, the AI just responded with text (normal conversation)
    if (data.message?.content) {
      return data.message.content;
    }

    return "De AI gaf geen antwoord.";

  } catch (error) {
    console.error("Fetch error:", error);
    return "Fout bij verbinden met Ollama.";
  }
}