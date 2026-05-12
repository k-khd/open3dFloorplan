import { currentProject } from "$lib/stores/project";
import { get } from "svelte/store";

export async function describeImageAI() {
    const project = get(currentProject);
    const floor = project?.floors.find(f => f.id === project.activeFloorId);

    const backgroundImage = floor?.backgroundImage?.dataUrl;
    if (!backgroundImage) {
        return "No background image found on the active floor. Upload an image in the floorplanner";
    }

    const image = backgroundImage?.split(',')[1];


    const response = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body : JSON.stringify({
            model: 'qwen3-vl:4b',
            messages: [{
                role: 'user', 
                content: '`Analyze this floor plan image. For each room, return a JSON array with the room name, width in meters, and height in meters. Only return JSON, nothing else. Format: [{"name": "", "width": , "height": }, {"name": "", "width": , "height": }]',
                images: [image],
            }],
            stream: false,
        })
    });

    // Turning the string response into JSON
    const data = await response.json();

    // getting text response from AI
    const content = data.message.content;
    console.log("Vision AI Response:", content);
    
    return content;
}