export const DRIVE_SPEED_KEY = 'unitree_ui.driveSpeedPercent';
export function driveSpeedPercent(value: number): number {
  return Number.isFinite(value) ? Math.max(10, Math.min(100, Math.round(value))) : 100;
}
export function loadDriveSpeed(): number {
  try { const raw = localStorage.getItem(DRIVE_SPEED_KEY); return raw === null ? 100 : driveSpeedPercent(Number(raw)); }
  catch { return 100; }
}
/** Scale manual axes only; never amplify beyond the existing joystick range. */
export function scaleDriveInput<T extends { lx: number; ly: number; rx: number; ry: number }>(state: T, percent: number): T {
  const factor = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) / 100 : 0;
  const axis = (value: number) => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) * factor : 0;
  return { ...state, lx: axis(state.lx), ly: axis(state.ly), rx: axis(state.rx), ry: axis(state.ry) };
}
