import { parseAudioList } from './audio-player';
import { latestParrotVoice, Parrot, type ParrotSettings } from '../parrot';

interface Options {
  storageKey: string;
  list(): Promise<unknown>;
  parrot: Parrot;
}

export function openParrotPanel(options: Options): () => void {
  const dialog = document.createElement('dialog');
  dialog.className = 'parrot-panel';
  dialog.setAttribute('aria-label', 'Parrot');
  dialog.innerHTML = `<h2>Parrot</h2>
    <p>Play the previous person’s voice, play the fixed line, then record the next voice.</p>
    <p>Recording uses Go2’s microphone. The last response is loaded automatically.</p>
    <p>Noise reduction is on. Pause briefly before speaking while it learns the background noise.</p>
    <form method="dialog">
      <label>Previous response (automatic)<output data-previous>Loading…</output></label>
      <label>Fixed middle line<select name="middle" required></select></label>
      <p>Recording stops after 3 seconds of quiet, or at 20 seconds maximum.</p>
      <p role="status" aria-live="polite">Loading recordings…</p>
      <div class="parrot-buttons"><button type="button" data-run disabled>Start Parrot</button><button type="button" data-close>Close</button></div>
    </form>`;
  const previous = dialog.querySelector<HTMLOutputElement>('[data-previous]')!;
  const middle = dialog.querySelector<HTMLSelectElement>('[name=middle]')!;
  const status = dialog.querySelector<HTMLElement>('[role=status]')!;
  const run = dialog.querySelector<HTMLButtonElement>('[data-run]')!;
  const close = dialog.querySelector<HTMLButtonElement>('[data-close]')!;
  let settings: ParrotSettings | undefined;
  let removed = false;
  let active = false;
  let previousId = '';
  let ownedPrevious = false;
  try { settings = JSON.parse(localStorage.getItem(options.storageKey) || 'null') || undefined; } catch { /* use defaults */ }
  const dismiss = () => {
    if (removed) return;
    removed = true; options.parrot.cancel(); dialog.close(); dialog.remove();
  };
  close.addEventListener('click', dismiss);
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  dialog.querySelector('form')!.addEventListener('submit', event => event.preventDefault());
  const load = async () => {
    const files = parseAudioList(await options.list());
    if (removed) return;
    for (const select of [middle]) {
      select.replaceChildren(new Option('Choose a saved recording', ''));
      for (const file of files) if (file.UNIQUE_ID) select.add(new Option(file.CUSTOM_NAME || file.UNIQUE_ID, file.UNIQUE_ID));
    }
    // Reload after a successful run so the next voice appears in the selector.
    try { settings = JSON.parse(localStorage.getItem(options.storageKey) || 'null') || undefined; } catch { /* defaults */ }
    const latest = latestParrotVoice(files, settings);
    previousId = latest?.id || '';
    ownedPrevious = latest?.owned || false;
    previous.textContent = latest?.name || 'First run — a response will be recorded for next time.';
    middle.value = settings?.middle || '';
    run.disabled = files.length < 1;
    status.textContent = files.length < 1 ? 'Save or upload your fixed middle line in More → Sound & voice first.'
      : 'Previous response is automatic. Choose the fixed middle line once, then Start Parrot.';
  };
  run.addEventListener('click', () => {
    if (active || !dialog.querySelector('form')!.reportValidity()) return;
    const next: ParrotSettings = {
      previous: previousId, middle: middle.value, ownedPrevious,
    };
    if (next.previous === next.middle) { status.textContent = 'Choose a different fixed line from the previous response.'; return; }
    try { localStorage.setItem(options.storageKey, JSON.stringify(next)); }
    catch { status.textContent = 'Could not save Parrot settings.'; return; }
    active = true; run.disabled = middle.disabled = true;
    close.textContent = 'Cancel';
    void options.parrot.start(next).then(async () => {
      if (removed) return;
      await load();
      status.textContent = 'New voice saved. Next press plays it first; the middle line stays the same.';
    }).catch(error => {
      if (!removed) status.textContent = error instanceof Error ? error.message : 'Parrot failed. Previous voice kept.';
    }).finally(() => {
      active = false;
      if (!removed) { run.disabled = middle.disabled = false; close.textContent = 'Close'; }
    });
  });
  document.body.appendChild(dialog); dialog.showModal();
  void load().catch(() => { if (!removed) status.textContent = 'Could not load recordings. Connect to Go2 and try again.'; });
  return dismiss;
}
