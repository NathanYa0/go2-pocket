import { Communication, VOICE_SLOTS, type CommunicationState } from '../communication';
import './communication-panel.css';

export function openCommunicationPanel(controller: Communication, preview = false): { close(preserveFilePicker?: boolean): void; render(state: CommunicationState): void } {
  const dialog = document.createElement('dialog');
  dialog.className = 'communication-panel';
  dialog.setAttribute('aria-labelledby', 'communication-title');
  dialog.innerHTML = `<header><div><h2 id="communication-title">Communication</h2><p>Saved voices, a friendly greeting.</p></div><button type="button" data-close aria-label="Close Communication">Close</button></header>
    <div class="communication-tools" role="group" aria-label="Audio controls"><button type="button" data-stop>Stop audio</button><button type="button" data-refresh>Refresh saved audio</button></div>
    <div class="communication-content">
      <p class="communication-help">Record on Go2: press again to stop and save (55s maximum). Pause briefly before speaking. Or upload WAV, MP3 or M4A. Recording or uploading replaces only that line.</p>
      <div class="communication-lines"></div>
      <p class="communication-help">Nice to meet you requests Go2’s standard paw greeting. Go2 lowers its paw automatically after this gesture.</p>
    </div>
    <footer><progress class="communication-upload-progress" max="100" value="0" aria-label="Audio upload progress" hidden></progress><p role="status" aria-live="polite"></p></footer>`;
  const lines = dialog.querySelector<HTMLElement>('.communication-lines')!;
  let pickingFile = false;
  const rows = VOICE_SLOTS.map(slot => {
    const row = document.createElement('section');
    row.className = 'communication-line';
    row.innerHTML = `<div class="communication-label"><h3></h3><span data-saved></span></div><div class="communication-buttons"><button type="button" data-play></button><button type="button" data-record></button></div>`;
    row.querySelector('h3')!.textContent = slot.label;
    if (slot.key === 'after1') {
      const note = document.createElement('small');
      note.className = 'communication-gesture-note';
      note.textContent = 'Starts when you press Stop & save for Voice line 1, while the recording uploads. You can also press Play.';
      row.querySelector('.communication-label')!.appendChild(note);
    }
    if (slot.key === 'nice') {
      const note = document.createElement('small');
      note.className = 'communication-gesture-note';
      note.textContent = 'Standard gesture · paw lowers automatically';
      row.querySelector('.communication-label')!.appendChild(note);
    }
    if (slot.key === 'music') {
      row.classList.add('communication-music');
      const note = document.createElement('small');
      note.className = 'communication-gesture-note';
      note.textContent = 'Plays once · repeats Dance 1 until the song ends';
      row.querySelector('.communication-label')!.appendChild(note);
    }
    const play = row.querySelector<HTMLButtonElement>('[data-play]')!;
    const record = row.querySelector<HTMLButtonElement>('[data-record]')!;
    play.textContent = slot.key === 'nice' ? 'Play + offer paw' : 'Play';
    if (slot.key === 'music') play.textContent = 'Music';
    play.setAttribute('aria-label', `Play ${slot.label}${slot.key === 'nice' ? ' and offer paw' : ''}`);
    play.onclick = () => { void controller.play(slot.key); };
    let songOnly: HTMLButtonElement | undefined;
    let clipDetails: HTMLElement | undefined;
    if (slot.key === 'music') {
      songOnly = document.createElement('button'); songOnly.type = 'button';
      songOnly.textContent = 'Play song only';
      songOnly.onclick = () => { void controller.play('music', false); };
      row.querySelector('.communication-buttons')!.appendChild(songOnly);
      clipDetails = document.createElement('small'); clipDetails.className = 'communication-clip-details';
      row.querySelector('.communication-label')!.appendChild(clipDetails);
    }
    record.onclick = () => { void controller.toggleRecord(slot.key); };
    let upload: HTMLButtonElement | undefined;
    if (slot.key !== 'line1' && slot.key !== 'line2') {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac'; input.hidden = true;
      input.setAttribute('aria-label', `Audio file for ${slot.label}`);
      upload = document.createElement('button'); upload.type = 'button';
      upload.textContent = 'Upload audio'; upload.setAttribute('aria-label', `Upload audio for ${slot.label}`);
      upload.onclick = () => {
        input.value = ''; pickingFile = true;
        input.click();
      };
      input.onchange = () => {
        pickingFile = false;
        const file = input.files?.[0];
        if (file) void controller.uploadFile(slot.key, file);
      };
      input.addEventListener('cancel', event => { event.stopPropagation(); pickingFile = false; });
      row.querySelector('.communication-buttons')!.append(upload, input);
    }
    const recovery = document.createElement('details');
    recovery.className = 'communication-recovery';
    recovery.innerHTML = '<summary>Use saved audio</summary><p>Already uploaded? Choose it from Go2’s library. This links the clip without uploading it again.</p>';
    const select = document.createElement('select');
    select.setAttribute('aria-label', `Saved audio for ${slot.label}`);
    const choose = document.createElement('button'); choose.type = 'button';
    choose.textContent = 'Use selected clip'; choose.setAttribute('aria-label', `Use selected clip for ${slot.label}`);
    choose.onclick = () => { void controller.useSavedClip(slot.key, select.value); };
    recovery.append(select, choose);
    // Keep recovery below the row's playback controls at every width.
    const wrapper = document.createElement('div'); wrapper.className = 'communication-slot';
    wrapper.append(row, recovery); lines.appendChild(wrapper);
    const saved = row.querySelector<HTMLElement>('[data-saved]')!;
    return { slot, wrapper, recovery, row, recordingRow: row, play, record, upload, songOnly, clipDetails, select, choose, signature: '', saved, recordingSaved: saved };
  });
  // Keep the interaction sequence in DOM order for touch and keyboard users.
  // Voice line 1's playback and recording still share the same saved slot.
  const bySlot = (key: typeof VOICE_SLOTS[number]['key']) => rows.find(refs => refs.slot.key === key)!;
  const line1 = bySlot('line1');
  line1.row.querySelector('h3')!.textContent = 'Play Voice line 1';
  const recordingRow = document.createElement('section');
  recordingRow.className = 'communication-line';
  recordingRow.innerHTML = '<div class="communication-label"><h3>Record Voice line 1</h3><span data-saved></span></div><div class="communication-buttons"></div>';
  recordingRow.querySelector('.communication-buttons')!.appendChild(line1.record);
  const recordingWrapper = document.createElement('div');
  recordingWrapper.className = 'communication-slot';
  recordingWrapper.append(recordingRow, line1.recovery);
  line1.recordingRow = recordingRow;
  line1.recordingSaved = recordingRow.querySelector<HTMLElement>('[data-saved]')!;
  lines.replaceChildren(bySlot('hi').wrapper, bySlot('nice').wrapper,
    line1.wrapper, bySlot('guide').wrapper, recordingWrapper,
    bySlot('after1').wrapper, bySlot('line2').wrapper, bySlot('music').wrapper);
  const status = dialog.querySelector<HTMLElement>('[role=status]')!;
  const progress = dialog.querySelector<HTMLProgressElement>('progress')!;
  const stop = dialog.querySelector<HTMLButtonElement>('[data-stop]')!;
  const refresh = dialog.querySelector<HTMLButtonElement>('[data-refresh]')!;
  refresh.onclick = () => { void controller.load(); };
  stop.onclick = () => { void controller.stopPlayback(); };
  let removed = false;
  const close = (preserveFilePicker = false) => {
    if (preserveFilePicker && pickingFile) return;
    if (removed) return;
    removed = true; void controller.close();
    document.removeEventListener('visibilitychange', hidden);
    window.removeEventListener('pagehide', pageHidden);
    dialog.close(); dialog.remove();
  };
  const pageHidden = () => close();
  const hidden = () => { if (document.hidden && !pickingFile) close(); };
  document.addEventListener('visibilitychange', hidden);
  window.addEventListener('pagehide', pageHidden);
  dialog.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => close();
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  const render = (state: CommunicationState) => {
    if (removed) return;
    status.textContent = preview ? 'Preview only. Connect to Go2 to record and play your voice lines.' : state.message;
    progress.hidden = preview || state.uploadPercent === undefined;
    progress.value = state.uploadPercent ?? 0;
    for (const refs of rows) {
      const { slot, row, recordingRow, recordingSaved, play, record, upload, songOnly, clipDetails, select, choose, saved } = refs;
      const signature = JSON.stringify(state.library.map(file => [file.UNIQUE_ID, file.CUSTOM_NAME]));
      if (signature !== refs.signature) {
        const previous = select.value;
        select.replaceChildren(new Option('Choose a clip saved on Go2', ''));
        for (const file of state.library) if (file.UNIQUE_ID) select.add(new Option(file.CUSTOM_NAME || file.UNIQUE_ID, file.UNIQUE_ID));
        select.value = previous; refs.signature = signature;
      }
      select.disabled = choose.disabled = preview || state.phase !== 'idle';
      const active = state.slot === slot.key && (state.phase === 'recording' || state.phase === 'starting');
      const hasClip = !!state.clips[slot.key];
      row.classList.toggle('is-recording', active && row === recordingRow);
      recordingRow.classList.toggle('is-recording', active);
      saved.textContent = active ? '● Recording' : hasClip ? 'Saved on Go2' : 'Not recorded yet';
      recordingSaved.textContent = saved.textContent;
      const canPlay = !preview && !state.audioBusy && hasClip && ['idle', 'saving'].includes(state.phase);
      play.disabled = !canPlay || (slot.key === 'music' && state.phase === 'saving');
      if (songOnly) songOnly.disabled = !canPlay;
      if (clipDetails) {
        const file = state.clips[slot.key];
        const bytes = Number(file?.FILE_SIZE);
        clipDetails.textContent = file ? `Selected: ${file.CUSTOM_NAME || file.UNIQUE_ID}${Number.isFinite(bytes) && bytes > 0 ? ` · ${(bytes / 1_000_000).toFixed(2)} MB reported by Go2` : ''}` : '';
      }
      if (upload) upload.disabled = preview || state.phase !== 'idle';
      record.disabled = preview || (!active && state.phase !== 'idle');
      record.textContent = active ? 'Stop & save' : hasClip ? 'Re-record' : 'Record';
      record.setAttribute('aria-label', `${active ? 'Stop and save' : hasClip ? 'Re-record' : 'Record'} ${slot.label}`);
      record.setAttribute('aria-pressed', String(active));
    }
    stop.textContent = state.phase === 'music' ? 'Stop music' : 'Stop audio';
    stop.disabled = preview || !!state.audioBusy || !['idle', 'saving', 'music'].includes(state.phase);
    refresh.disabled = preview || state.phase !== 'idle';
  };
  document.body.appendChild(dialog); render(controller.state); dialog.showModal();
  if (!preview) void controller.load();
  return { close, render };
}
