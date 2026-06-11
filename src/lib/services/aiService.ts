import { beginUndoGroup, endUndoGroup } from '$lib/stores/project';
import { tools, executeAction } from './aiActions';
import { getActiveFloor } from './aiResolvers';

export async function askAI(userMessage: string) {
  const floor = getActiveFloor();
  if (!floor) return 'Geen project of actieve verdieping geladen.';

  const roomNames = floor.rooms.map((r) => r.name).join(', ') || '(nog geen kamers)';

  try {
    const response = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'Qwen3.5:4b',
        messages: [
          {
            role: 'system',
            content: `Je bent een behulpzame assistent voor het ontwerpen van plattegronden. 
            Help gebruikers in het Nederlands met het aanmaken, aanpassen en inrichten van kamers (meubels, deuren, ramen, trappen). 
            Als er geen actie nodig is, praat je gewoon kort en vriendelijk terug. Houd antwoorden kort, maximaal 2-3 zinnen.
            Beschikbare kamers op de huidige plattegrond: ${roomNames}.`
          },
          { role: 'user', content: userMessage },
        ],
        tools,
        stream: false,
        options: { num_ctx: 8192, temperature: 0.1 },
      }),
    });

    const data = await response.json();
    console.log('AI Response:', JSON.stringify(data.message, null, 2));

    const calls = data.message?.tool_calls ?? [];

    // No tool call -> the model is just responding.
    if (calls.length === 0) {
      return data.message?.content ?? 'De AI gaf geen antwoord.';
    }

    /**
     * Wrap all tool calls from one user command into a single undo step. 
     * The editor functions called inside executeAction run through mutate()
     * so undo/redo + room detection are handled automatically.
    */
    beginUndoGroup();
    let result = '';
    try {
      for (const toolCall of calls) {
        result += executeAction(toolCall) + ' ';
      }
    } finally {
      endUndoGroup(userMessage);
    }

    return result.trim();
  } catch (error) {
    console.error('Fetch error:', error);
    return 'Fout bij verbinden met Ollama.';
  }
}