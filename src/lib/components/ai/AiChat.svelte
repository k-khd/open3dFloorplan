<script lang="ts">
  import { askAI } from '$lib/services/aiService';
  import { tick } from 'svelte';
  import { scanAndBuildFloorplan } from '$lib/services/imageService';

  let { open = $bindable(false) }: { open: boolean } = $props();
  let userInput = $state('');
  let messages = $state<{ role: string; text: string }[]>([]);
  let loading = $state(false);
  let chatContainer = $state<HTMLDivElement | null>(null);

  async function sendMessage() {
    if (!userInput.trim() || loading) return;

    const question = userInput;
    loading = true;
    userInput = '';
    messages = [...messages, { role: 'user', text: question }];

    await tick();
    chatContainer?.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });

    const answer = await askAI(question);
    messages = [...messages, { role: 'ai', text: answer }];
    loading = false;

    await tick();
    chatContainer?.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
  }

  async function scanFloorPlan() {
    loading = true;
    messages = [...messages, { role: 'user', text: 'Scanning your uploaded floor plan...' }];

    await tick();
    chatContainer?.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });

    const result = await scanAndBuildFloorplan();
    messages = [...messages, { role: 'ai', text: result.message }];
    loading = false;

    await tick();
    chatContainer?.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
}

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }
</script>

{#if open}
<div class="fixed right-4 bottom-4 w-96 h-[500px] bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col z-50">
  
  <!-- Header -->
  <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">

    <div class="flex items-center gap-2">

      <img src="/ai-logo.png" alt="AI" width="20" height="20" />
      <span class="font-semibold text-sm text-gray-800 dark:text-gray-100">AI Assistent</span>
      <button onclick={scanFloorPlan} disabled={loading} class="px-2 py-1 text-xs bg-slate-600 text-white rounded hover:bg-slate-500 disabled:opacity-50"> Scan Floorplan </button>

    </div>
    <button onclick={() => open = false} class="text-gray-400 hover:text-gray-600 text-lg">✕</button>

  </div>

  <!-- Messages -->
  <div class="flex-1 overflow-y-auto p-4 space-y-3" bind:this={chatContainer}>
    {#if messages.length === 0}
      <p class="text-sm text-gray-400 text-center mt-8">Test verschillende opdrachten met behulp van AI:</p>
      <p class="text-sm text-gray-400 text-center mt-8">Genereer simpele kamers en label ze met een specifieke ID</p>
      <p class="text-sm text-gray-400 text-center mt-8">Meubels, deuren, ramen en trappen plaatsen binnen specifieke kamers is mogelijk (vermeld ID)</p>
      <p class="text-sm text-gray-400 text-center mt-8">Probeer zo specifiek mogelijk te zijn!</p>

    {/if}
    {#each messages as msg}
      <div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}">
        <div class="max-w-[80%] px-3 py-2 rounded-lg text-sm {msg.role === 'user' ? 'bg-slate-700 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100'}">
          {msg.text}
        </div>
      </div>
    {/each}
    {#if loading}
      <div class="flex justify-start">
        <div class="px-3 py-2 rounded-lg text-sm bg-gray-100 dark:bg-gray-700 text-gray-500 animate-pulse">Thinking...</div>
      </div>
    {/if}
  </div>

  <!-- Input field -->
  <div class="p-3 border-t border-gray-200 dark:border-gray-700">
    <div class="flex gap-2">
      <input
        type="text"
        bind:value={userInput}
        onkeydown={ (e) => { e.stopPropagation(); onKeydown(e); } }
        placeholder="Stel een vraag..."
        class="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-slate-500 bg-white dark:bg-gray-700 dark:text-gray-100"
      />
      <button
        onclick={sendMessage}
        disabled={loading}
        class="px-3 py-2 bg-slate-700 text-white text-sm rounded-lg hover:bg-slate-600 disabled:opacity-50"
      >Stuur</button>
    </div>
  </div>
</div>
{/if}