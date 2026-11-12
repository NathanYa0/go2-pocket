import { SPORT_CMD } from '../protocol/topics';

export const EXPLORE_FORWARD_SPEED = 0.4;
export const EXPLORE_YAW_RATE = 0.6;
export const EXPLORE_MIN_TURN_RATE = 0.4;
export const EXPLORE_MEASURED_SPEED_LIMIT = 1.0;
// Independently configured corridor retained at the user-selected 73 cm.
// This is a planning margin, not a guaranteed stopping bound at the speed cutoff.
export const EXPLORE_STOP_CORRIDOR = 0.73;

interface Transport {
  ready(): boolean;
  emergencyStopped(): boolean;
  request(api: number, parameter: string, priority?: boolean): void;
}

/** Bound the actuator request independently of the planner's output. */
export function explorationMotion(transport: Transport): (forward: number, yawRate: number) => boolean {
  return (forward, yawRate) => {
    if (!Number.isFinite(forward) || !Number.isFinite(yawRate) || forward < 0 || forward > EXPLORE_FORWARD_SPEED || Math.abs(yawRate) > EXPLORE_YAW_RATE) return false;
    const moving = forward !== 0 || yawRate !== 0;
    if (!transport.ready() || (moving && transport.emergencyStopped())) return false;
    transport.request(moving ? SPORT_CMD.Move : SPORT_CMD.StopMove,
      moving ? JSON.stringify({ x: forward, y: 0, z: yawRate }) : '{}', moving ? undefined : true);
    return true;
  };
}
