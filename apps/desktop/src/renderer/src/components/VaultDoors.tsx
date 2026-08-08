import { ReactNode, useEffect, useState } from 'react';

import { Loader } from './Loader';

export type DoorState = 'closed' | 'opening' | 'closing';

/**
 * The doors move decisively and settle without bouncing on the way open; they
 * shut faster, with a hint of overshoot so it reads as a latch.
 */
export const DOOR_MOTION = {
  opening: { ms: 560, ease: 'cubic-bezier(.2,.8,.2,1)' },
  closing: { ms: 380, ease: 'cubic-bezier(.35,1.3,.6,1)' },
} as const;

/** How long the panels take to reach the state the caller asked for. */
export const doorDuration = (
  state: DoorState,
  reducedMotion: boolean
): number => {
  if (reducedMotion) return 0;
  return state === 'closing' ? DOOR_MOTION.closing.ms : DOOR_MOTION.opening.ms;
};

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The door face: the mark, centred on the viewport regardless of which panel
 * clips it, so one panel and two panels look identical.
 */
const Face = ({ working }: { working: boolean }) => (
  <div className="absolute inset-y-0 flex w-screen items-center justify-center">
    <Loader className="h-[22vh] max-h-48 opacity-90" animate={working} />
  </div>
);

/**
 * A pair of vault doors over the app. Locked, the app is a single unbroken
 * surface carrying the dcrypt mark; unlocking splits it down the middle and
 * slides the halves away to reveal the vault already rendered underneath, and
 * locking slides them shut again.
 *
 * While moving, each panel clips a viewport-wide copy of the same face, so the
 * halves compose one mark that tears apart as they travel. At rest the surface
 * is one element, so there is no seam to see.
 */
export const VaultDoors = ({
  state,
  working = false,
  onRest,
  children,
}: {
  state: DoorState;
  /** Animates the mark while the key is being derived. */
  working?: boolean;
  /** Fired once the panels have reached their destination. */
  onRest?: () => void;
  /** The unlock controls, which leave with the doors. */
  children?: ReactNode;
}) => {
  const reduced = prefersReducedMotion();
  // start where the previous state left the panels, then move on the next frame
  const [parted, setParted] = useState(state === 'closing');

  useEffect(() => {
    if (state === 'closed') {
      setParted(false);
      return;
    }
    const frame = requestAnimationFrame(() => setParted(state === 'opening'));
    return () => cancelAnimationFrame(frame);
  }, [state]);

  useEffect(() => {
    if (state === 'closed' || !onRest) return;
    const timer = setTimeout(onRest, doorDuration(state, reduced) + 40);
    return () => clearTimeout(timer);
  }, [state, reduced, onRest]);

  const motion =
    state === 'closing' ? DOOR_MOTION.closing : DOOR_MOTION.opening;
  const sealed = state === 'closed';

  return (
    <div className="absolute inset-0 z-40" aria-hidden={!sealed}>
      {sealed ? (
        <div
          data-testid="vault-door-sealed"
          className="absolute inset-0 overflow-hidden bg-background"
        >
          <Face working={working} />
        </div>
      ) : (
        (['left', 'right'] as const).map((side) => (
          <div
            key={side}
            data-testid={`vault-door-${side}`}
            className={`absolute inset-y-0 w-1/2 overflow-hidden bg-background ${
              side === 'left' ? 'left-0' : 'right-0'
            }`}
            style={{
              transition: reduced
                ? 'opacity 120ms linear'
                : `transform ${motion.ms}ms ${motion.ease}`,
              transform: parted
                ? `translateX(${side === 'left' ? '-100%' : '100%'})`
                : 'translateX(0)',
              // the inner edges cast onto the vault, so the panels read as
              // sitting above it while they travel
              boxShadow:
                side === 'left'
                  ? '10px 0 28px -6px rgb(0 0 0 / 0.4)'
                  : '-10px 0 28px -6px rgb(0 0 0 / 0.4)',
              opacity: reduced && parted ? 0 : 1,
            }}
          >
            {/* offset so the two clipped copies compose one mark */}
            <div
              className="absolute inset-y-0 w-screen"
              style={{ left: side === 'left' ? 0 : '-50vw' }}
            >
              <Face working={working} />
            </div>
          </div>
        ))
      )}

      {/* the controls ride on the doors: they shrink away as the panels part */}
      <div
        className={`absolute inset-x-0 bottom-[12vh] flex justify-center ${sealed ? '' : 'pointer-events-none'}`}
        style={{
          opacity: sealed ? 1 : 0,
          transform: sealed ? 'scale(1)' : 'scale(0.94)',
          transition: reduced
            ? 'opacity 120ms linear'
            : 'opacity 220ms linear, transform 320ms cubic-bezier(.2,.8,.2,1)',
        }}
      >
        {children}
      </div>
    </div>
  );
};
