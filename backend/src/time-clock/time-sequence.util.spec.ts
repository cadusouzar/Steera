import { TimeEventType } from '@prisma/client';
import { computeOpenState, getNextAllowedType, OpenState, validateTransition } from './time-sequence.util';

const ev = (...types: TimeEventType[]) => types.map((type) => ({ type }));

describe('computeOpenState', () => {
  it('returns all-closed for no events', () => {
    expect(computeOpenState([])).toEqual({ clockOpen: false, breakOpen: false, extraOpen: false });
  });

  it('opens clock after CLOCK_IN', () => {
    expect(computeOpenState(ev('CLOCK_IN'))).toEqual({ clockOpen: true, breakOpen: false, extraOpen: false });
  });

  it('closes clock after CLOCK_IN -> CLOCK_OUT', () => {
    expect(computeOpenState(ev('CLOCK_IN', 'CLOCK_OUT'))).toEqual({
      clockOpen: false,
      breakOpen: false,
      extraOpen: false,
    });
  });

  it('tracks an open break within an open clock', () => {
    expect(computeOpenState(ev('CLOCK_IN', 'BREAK_START'))).toEqual({
      clockOpen: true,
      breakOpen: true,
      extraOpen: false,
    });
  });

  it('closes the break after BREAK_END, clock stays open', () => {
    expect(computeOpenState(ev('CLOCK_IN', 'BREAK_START', 'BREAK_END'))).toEqual({
      clockOpen: true,
      breakOpen: false,
      extraOpen: false,
    });
  });

  it('handles multiple break intervals in the same journey (derives from full history, not just the last event)', () => {
    expect(
      computeOpenState(ev('CLOCK_IN', 'BREAK_START', 'BREAK_END', 'BREAK_START', 'BREAK_END')),
    ).toEqual({ clockOpen: true, breakOpen: false, extraOpen: false });
  });

  it('tracks an open extra period', () => {
    expect(computeOpenState(ev('CLOCK_IN', 'EXTRA_IN'))).toEqual({
      clockOpen: true,
      breakOpen: false,
      extraOpen: true,
    });
  });

  it('is derived by walking the FULL ordered history, not just counting events or looking at the last one (a stray/duplicate CLOCK_IN in the middle does not confuse a later, correct read)', () => {
    // Regression guard for the exact bug this module replaces: a positional index
    // (events.length) would misread this as "5 events in, so slot 5" instead of correctly
    // deriving clockOpen=true, breakOpen=false from walking every event in order.
    const state = computeOpenState(ev('CLOCK_IN', 'BREAK_START', 'BREAK_END', 'EXTRA_IN', 'EXTRA_OUT'));
    expect(state).toEqual({ clockOpen: true, breakOpen: false, extraOpen: false });
  });

  it('handles a full day spanning midnight (clock still open across the day boundary is just "more events in order" to this function)', () => {
    // computeOpenState itself has no notion of calendar day — it only cares about event order —
    // so a journey that started "yesterday" and has an open break "today" is handled identically.
    const state = computeOpenState(ev('CLOCK_IN', 'BREAK_START'));
    expect(state).toEqual({ clockOpen: true, breakOpen: true, extraOpen: false });
  });
});

describe('getNextAllowedType', () => {
  const closed: OpenState = { clockOpen: false, breakOpen: false, extraOpen: false };
  const openPlain: OpenState = { clockOpen: true, breakOpen: false, extraOpen: false };
  const openBreak: OpenState = { clockOpen: true, breakOpen: true, extraOpen: false };
  const openExtra: OpenState = { clockOpen: true, breakOpen: false, extraOpen: true };

  it('suggests CLOCK_IN when nothing is open', () => {
    expect(getNextAllowedType(closed, true)).toBe('CLOCK_IN');
    expect(getNextAllowedType(closed, false)).toBe('CLOCK_IN');
  });

  it('suggests BREAK_END when a break is open', () => {
    expect(getNextAllowedType(openBreak, true)).toBe('BREAK_END');
  });

  it('suggests EXTRA_OUT when an extra period is open', () => {
    expect(getNextAllowedType(openExtra, true)).toBe('EXTRA_OUT');
  });

  it('suggests CLOCK_OUT as the primary action when the journey is open with nothing else in progress', () => {
    expect(getNextAllowedType(openPlain, true)).toBe('CLOCK_OUT');
    expect(getNextAllowedType(openPlain, false)).toBe('CLOCK_OUT');
  });
});

describe('validateTransition', () => {
  const closed: OpenState = { clockOpen: false, breakOpen: false, extraOpen: false };
  const openPlain: OpenState = { clockOpen: true, breakOpen: false, extraOpen: false };
  const openBreak: OpenState = { clockOpen: true, breakOpen: true, extraOpen: false };
  const openExtra: OpenState = { clockOpen: true, breakOpen: false, extraOpen: true };

  // --- CLOCK_IN ---
  it('CLOCK_IN is valid when nothing is open', () => {
    expect(validateTransition(closed, 'CLOCK_IN', true)).toBe('VALID');
  });

  it('CLOCK_IN twice in a row without CLOCK_OUT is invalid', () => {
    expect(validateTransition(openPlain, 'CLOCK_IN', true)).toBe('INVALID');
  });

  it('CLOCK_IN is invalid while a break is open', () => {
    expect(validateTransition(openBreak, 'CLOCK_IN', true)).toBe('INVALID');
  });

  it('CLOCK_IN is invalid while an extra period is open', () => {
    expect(validateTransition(openExtra, 'CLOCK_IN', true)).toBe('INVALID');
  });

  // --- CLOCK_OUT ---
  it('CLOCK_OUT is valid when the journey is open with nothing else in progress', () => {
    expect(validateTransition(openPlain, 'CLOCK_OUT', true)).toBe('VALID');
  });

  it('CLOCK_OUT without an open journey is invalid', () => {
    expect(validateTransition(closed, 'CLOCK_OUT', true)).toBe('INVALID');
  });

  it('CLOCK_OUT while a break is open is invalid (must BREAK_END first)', () => {
    expect(validateTransition(openBreak, 'CLOCK_OUT', true)).toBe('INVALID');
  });

  it('CLOCK_OUT while an extra period is open is invalid (must EXTRA_OUT first)', () => {
    expect(validateTransition(openExtra, 'CLOCK_OUT', true)).toBe('INVALID');
  });

  // --- BREAK_START ---
  it('BREAK_START is valid when the journey is open with nothing else in progress', () => {
    expect(validateTransition(openPlain, 'BREAK_START', true)).toBe('VALID');
  });

  it('BREAK_START without an open journey is invalid', () => {
    expect(validateTransition(closed, 'BREAK_START', true)).toBe('INVALID');
  });

  it('BREAK_START while a break is already open is invalid', () => {
    expect(validateTransition(openBreak, 'BREAK_START', true)).toBe('INVALID');
  });

  it('BREAK_START while an extra period is open is invalid', () => {
    expect(validateTransition(openExtra, 'BREAK_START', true)).toBe('INVALID');
  });

  // --- BREAK_END ---
  it('BREAK_END is valid when a break is open', () => {
    expect(validateTransition(openBreak, 'BREAK_END', true)).toBe('VALID');
  });

  it('BREAK_END without an open break is invalid', () => {
    expect(validateTransition(openPlain, 'BREAK_END', true)).toBe('INVALID');
  });

  it('BREAK_END with no journey open at all is invalid', () => {
    expect(validateTransition(closed, 'BREAK_END', true)).toBe('INVALID');
  });

  // --- EXTRA_IN ---
  it('EXTRA_IN is valid when allowed, journey open, nothing else in progress', () => {
    expect(validateTransition(openPlain, 'EXTRA_IN', true)).toBe('VALID');
  });

  it('EXTRA_IN is invalid when allowExtraPeriods is false, even with an open journey and nothing else in progress', () => {
    expect(validateTransition(openPlain, 'EXTRA_IN', false)).toBe('INVALID');
  });

  it('EXTRA_IN is invalid without an open journey, even when allowed', () => {
    expect(validateTransition(closed, 'EXTRA_IN', true)).toBe('INVALID');
  });

  it('EXTRA_IN is invalid while a break is already open (another period already open)', () => {
    expect(validateTransition(openBreak, 'EXTRA_IN', true)).toBe('INVALID');
  });

  it('EXTRA_IN is invalid while an extra period is already open', () => {
    expect(validateTransition(openExtra, 'EXTRA_IN', true)).toBe('INVALID');
  });

  // --- EXTRA_OUT ---
  it('EXTRA_OUT is valid when an extra period is open', () => {
    expect(validateTransition(openExtra, 'EXTRA_OUT', true)).toBe('VALID');
  });

  it('EXTRA_OUT without an open extra period is invalid', () => {
    expect(validateTransition(openPlain, 'EXTRA_OUT', true)).toBe('INVALID');
  });

  it('EXTRA_OUT with no journey open at all is invalid', () => {
    expect(validateTransition(closed, 'EXTRA_OUT', true)).toBe('INVALID');
  });

  // --- Full sequences, validated step by step against computeOpenState ---
  it('validates a full CLOCK_IN -> BREAK_START -> BREAK_END -> CLOCK_OUT sequence as valid at every step', () => {
    let state = computeOpenState([]);
    expect(validateTransition(state, 'CLOCK_IN', true)).toBe('VALID');
    state = computeOpenState(ev('CLOCK_IN'));

    expect(validateTransition(state, 'BREAK_START', true)).toBe('VALID');
    state = computeOpenState(ev('CLOCK_IN', 'BREAK_START'));

    expect(validateTransition(state, 'BREAK_END', true)).toBe('VALID');
    state = computeOpenState(ev('CLOCK_IN', 'BREAK_START', 'BREAK_END'));

    expect(validateTransition(state, 'CLOCK_OUT', true)).toBe('VALID');
  });

  it('validates a journey with multiple break intervals as valid at every step', () => {
    const sequence: TimeEventType[] = [
      'CLOCK_IN',
      'BREAK_START',
      'BREAK_END',
      'BREAK_START',
      'BREAK_END',
      'CLOCK_OUT',
    ];
    let history: TimeEventType[] = [];
    for (const type of sequence) {
      const state = computeOpenState(ev(...history));
      expect(validateTransition(state, type, true)).toBe('VALID');
      history = [...history, type];
    }
  });

  it('validates a journey with an extra period nested between two breaks (multiple interval TYPES in one day)', () => {
    const sequence: TimeEventType[] = [
      'CLOCK_IN',
      'BREAK_START',
      'BREAK_END',
      'EXTRA_IN',
      'EXTRA_OUT',
      'BREAK_START',
      'BREAK_END',
      'CLOCK_OUT',
    ];
    let history: TimeEventType[] = [];
    for (const type of sequence) {
      const state = computeOpenState(ev(...history));
      expect(validateTransition(state, type, true)).toBe('VALID');
      history = [...history, type];
    }
  });

  it('rejects EXTRA_IN partway through an otherwise-valid sequence when allowExtraPeriods is false, while the rest of the sequence stays valid', () => {
    const state = computeOpenState(ev('CLOCK_IN'));
    expect(validateTransition(state, 'EXTRA_IN', false)).toBe('INVALID');
    expect(validateTransition(state, 'BREAK_START', false)).toBe('VALID');
    expect(validateTransition(state, 'CLOCK_OUT', false)).toBe('VALID');
  });

  it('a journey spanning midnight (CLOCK_IN before midnight, CLOCK_OUT after) is validated purely by open/closed state, with no dependency on calendar day', () => {
    // Simulates: CLOCK_IN at 23:00, BREAK_START at 23:30, BREAK_END at 00:10 (next day),
    // CLOCK_OUT at 07:00 (next day). computeOpenState/validateTransition only see event order,
    // never timestamps or calendar days, so this is indistinguishable from any other sequence.
    let history: TimeEventType[] = [];
    for (const type of ['CLOCK_IN', 'BREAK_START', 'BREAK_END', 'CLOCK_OUT'] as TimeEventType[]) {
      const state = computeOpenState(ev(...history));
      expect(validateTransition(state, type, true)).toBe('VALID');
      history = [...history, type];
    }
    expect(computeOpenState(ev(...history))).toEqual({ clockOpen: false, breakOpen: false, extraOpen: false });
  });
});
