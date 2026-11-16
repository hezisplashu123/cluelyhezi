document.addEventListener('DOMContentLoaded', async () => {
  const select = document.getElementById('assistantModeSelect');
  const send = document.getElementById('sendRecordedSpeech');
  send?.addEventListener('click', async () => {
    send.disabled = true; send.textContent = 'Sending...';
    try { const result = await window.electronAPI.forceSendSpeech(); send.title = result.message; }
    catch (error) { send.title = error.message; }
    finally { send.disabled = false; send.textContent = 'Send'; }
  });
  const apply = value => {
    if (!select) return;
    select.value = value.mode;
    select.style.background = value.mode === 'case_interview' ? '#0f766e' : value.mode === 'behavioral_star' ? '#1d4ed8' : '#111827';
  };
  try { apply(await window.electronAPI.getAssistantMode()); } catch (error) { console.error(error); }
  window.electronAPI.onAssistantMode(apply);
  select?.addEventListener('change', async () => {
    select.disabled = true;
    try { apply(await window.electronAPI.setAssistantMode(select.value)); }
    catch (error) { select.title = error.message; apply(await window.electronAPI.getAssistantMode()); }
    finally { select.disabled = false; }
  });
});
