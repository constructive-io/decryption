import { describe, expect, it } from 'vitest';

import { DOOR_MOTION, doorDuration } from '../src/renderer/src/components/VaultDoors';

describe('doorDuration', () => {
  it('shuts faster than it opens, so locking feels like a latch', () => {
    expect(doorDuration('closing', false)).toBeLessThan(doorDuration('opening', false));
    expect(doorDuration('opening', false)).toBe(DOOR_MOTION.opening.ms);
  });

  it('collapses to nothing when the user asked for less motion', () => {
    expect(doorDuration('opening', true)).toBe(0);
    expect(doorDuration('closing', true)).toBe(0);
  });

  it('opens over the 450–650ms the design calls for', () => {
    expect(DOOR_MOTION.opening.ms).toBeGreaterThanOrEqual(450);
    expect(DOOR_MOTION.opening.ms).toBeLessThanOrEqual(650);
  });
});
