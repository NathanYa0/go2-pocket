import { Communication, VOICE_SLOTS, type CommunicationState } from '../communication';
import './communication-panel.css';

export function openCommunicationPanel(controller: Communication, preview = false): { close(): void; render(state: CommunicationState): void } {
  const dialog = document.createElement('dialog');
  dialog.className = 'communication-panel';
  dialog.setAttribute('aria-labelledby', 'communication-title');
  dialog.innerHTML = `<header><div><h2 id="communication-title">Communication</h2><p>Saved voices, a friendly greeting.</p></div><button type="button" data-close aria-label="Close Communication">Close</button></header>
    <div class="communication-tools" role="group" aria-label="Audio controls"><button type="button" data-stop>Stop audio</button></div>
    <div class="communication-content">
      <p class="communication-help">Record with Go2’s microphone; play through its speaker. Pause briefly before speaking. Press Record again to stop and save. Re-record replaces only that line. Recordings also save automatically at 55 seconds.</p>
      <div class="communication-lines"></div>
      <p class="communication-help">Nice to meet you requests Go2’s standard paw greeting. Go2 lowers its paw automatically after this gesture.</p>
    </div>
    <footer><p role="status" aria-live="polite"></p></footer>`;
  const lines = dialog.querySelector<HTMLElement>('.communication-lines')!;
  const rows = VOICE_SLOTS.map(slot => {
    const row = document.createElement('section');
    row.className = 'communication-line';
    row.innerHTML = `<div class="communication-label"><h3></h3><span data-saved></span></div><div class="communication-buttons"><button type="button" data-play></button><button type="button" data-record></button></div>`;
    row.querySelector('h3')!.textContent = slot.label;
    if (slot.key === 'nice') {
      const note = document.createElement('small');
      note.className = 'communication-gesture-note';
      note.textContent = 'Standard gesture · paw lowers automatically';
      row.querySelector('.communication-label')!.appendChild(note);
    }
    const play = row.querySelector<HTMLButtonElement>('[data-play]')!;
    const record = row.querySelector<HTMLButtonElement>('[data-record]')!;
    play.textContent = slot.key === 'nice' ? 'Play + offer paw' : 'Play';
    play.setAttribute('aria-label', `Play ${slot.label}${slot.key === 'nice' ? ' and offer paw' : ''}`);
    play.onclick = () => { void controller.play(slot.key); };
    record.onclick = () => { void controller.toggleRecord(slot.key); };
    lines.appendChild(row);
    return { slot, row, play, record, saved: row.querySelector<HTMLElement>('[data-saved]')! };
  });
  const status = dialog.querySelector<HTMLElement>('[role=status]')!;
  const stop = dialog.querySelector<HTMLButtonElement>('[data-stop]')!;
  stop.onclick = () => { void controller.stopPlayback(); };
  let removed = false;
  const close = () => {
    if (removed) return;
    removed = true; void controller.close();
    document.removeEventListener('visibilitychange', hidden);
    window.removeEventListener('pagehide', close);
    dialog.close(); dialog.remove();
  };
  const hidden = () => { if (document.hidden) close(); };
  document.addEventListener('visibilitychange', hidden);
  window.addEventListener('pagehide', close);
  dialog.querySelector<HTMLButtonElement>('[data-close]')!.onclick = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  const render = (state: CommunicationState) => {
    if (removed) return;
    status.textContent = preview ? 'Preview only. Connect to Go2 to record and play your voice lines.' : state.message;
    for (const { slot, row, play, record, saved } of rows) {
      const active = state.slot === slot.key && (state.phase === 'recording' || state.phase === 'starting');
      const hasClip = !!state.clips[slot.key];
      row.classList.toggle('is-recording', active);
      saved.textContent = active ? '● Recording' : hasClip ? 'Saved on Go2' : 'Not recorded yet';
      play.disabled = preview || state.phase !== 'idle' || !hasClip;
      record.disabled = preview || (!active && state.phase !== 'idle');
      record.textContent = active ? 'Stop & save' : hasClip ? 'Re-record' : 'Record';
      record.setAttribute('aria-label', `${active ? 'Stop and save' : hasClip ? 'Re-record' : 'Record'} ${slot.label}`);
      record.setAttribute('aria-pressed', String(active));
    }
    stop.disabled = preview || state.phase !== 'idle';
  };
  document.body.appendChild(dialog); render(controller.state); dialog.showModal();
  if (!preview) void controller.load();
  return { close, render };
}
