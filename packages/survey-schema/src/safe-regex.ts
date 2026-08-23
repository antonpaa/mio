/**
 * The linear-time-safe regex subset (E12). Authored patterns run on the
 * request path, so catastrophic backtracking is a denial-of-service surface
 * (docs/architecture/surveys-and-alerts.md). Instead of shipping RE2 (a
 * native SOUP dependency, ADR-0009), we constrain the LANGUAGE so the
 * built-in engine cannot blow up:
 *
 *   - no lookaround, no backreferences, no named groups
 *   - an UNBOUNDED quantifier (*, +, {n,}) on a group requires the group to
 *     contain NO alternation and NO quantifier - that rules out every
 *     ambiguous-repetition shape ((a|a)+, (a+)+, (a*)*) that backtracking
 *     engines are exponential on; `?` on a group runs the body at most once
 *     and is allowed over any safe body ((\.\d+)? and (?:mg|ml)? stay
 *     legal); bounded {n,m} with m>1 counts as repetition and follows the
 *     unbounded rule
 *   - bounded repetition capped at {,100}, pattern length capped at 200
 *   - at most 3 UNBOUNDED quantifiers and 10 quantified groups per pattern:
 *     chains of merely-polynomial repetition are still a denial of service
 *     at depth, so the counts are capped; with the 200-char input cap in
 *     the validator the worst case stays in the millions of steps
 *
 * The builder rejects at authoring time what the runtime would reject here;
 * compileSafePattern re-checks at evaluation time so a pattern that somehow
 * bypassed authoring still cannot run unconstrained.
 */

export const MAX_PATTERN_LENGTH = 200;
export const MAX_BOUNDED_REPEAT = 100;
export const MAX_UNBOUNDED_QUANTIFIERS = 3;
export const MAX_QUANTIFIED_GROUPS = 10;
/** Longest value a pattern is evaluated against (validator enforces it). */
export const MAX_PATTERN_INPUT_LENGTH = 200;

class PatternError extends Error {}

interface GroupInfo {
  hasAlternation: boolean;
  hasQuantifier: boolean;
}

/** Throws with a reason when the pattern falls outside the safe subset. */
export function assertSafePattern(pattern: string): void {
  if (pattern.length === 0) throw new PatternError('empty pattern');
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new PatternError(`pattern longer than ${MAX_PATTERN_LENGTH}`);
  }
  const state = { input: pattern, position: 0, unbounded: 0, quantifiedGroups: 0 };
  parseAlternation(state, 0);
  if (state.position !== pattern.length) {
    throw new PatternError(`unexpected ')' at ${state.position}`);
  }
  if (state.unbounded > MAX_UNBOUNDED_QUANTIFIERS) {
    throw new PatternError(`more than ${MAX_UNBOUNDED_QUANTIFIERS} unbounded quantifiers`);
  }
  if (state.quantifiedGroups > MAX_QUANTIFIED_GROUPS) {
    throw new PatternError(`more than ${MAX_QUANTIFIED_GROUPS} quantified groups`);
  }
}

export function isSafePattern(pattern: string): boolean {
  try {
    assertSafePattern(pattern);
    return true;
  } catch {
    return false;
  }
}

/** Validates, then compiles the pattern anchored over the whole value. */
export function compileSafePattern(pattern: string): RegExp {
  assertSafePattern(pattern);
  return new RegExp(`^(?:${pattern})$`, 'u');
}

interface ParseState {
  input: string;
  position: number;
  unbounded: number;
  quantifiedGroups: number;
}

type QuantifierKind = 'optional' | 'bounded' | 'unbounded';

const peek = (state: ParseState): string | undefined => state.input[state.position];

function parseAlternation(state: ParseState, depth: number): GroupInfo {
  if (depth > 10) throw new PatternError('grouping nested too deep');
  const info: GroupInfo = { hasAlternation: false, hasQuantifier: false };
  const branch = parseSequence(state, depth);
  info.hasQuantifier = branch.hasQuantifier;
  info.hasAlternation = branch.hasAlternation;
  while (peek(state) === '|') {
    state.position += 1;
    info.hasAlternation = true;
    const next = parseSequence(state, depth);
    info.hasQuantifier = info.hasQuantifier || next.hasQuantifier;
  }
  return info;
}

function parseSequence(state: ParseState, depth: number): GroupInfo {
  const info: GroupInfo = { hasAlternation: false, hasQuantifier: false };
  for (;;) {
    const ch = peek(state);
    if (ch === undefined || ch === '|' || ch === ')') return info;
    const atom = parseAtom(state, depth);
    const quantifier = parseQuantifier(state);
    if (quantifier !== undefined) {
      if (atom.kind === 'group') {
        state.quantifiedGroups += 1;
        // `?` runs the body at most once and the group count is capped, so
        // anything safe on its own is safe optional; actual REPETITION of
        // an ambiguous body is what explodes, so it stays forbidden
        if (quantifier !== 'optional' && (atom.info.hasAlternation || atom.info.hasQuantifier)) {
          throw new PatternError(
            'repetition of a group containing alternation or another quantifier',
          );
        }
      }
      info.hasQuantifier = true;
    }
    if (atom.kind === 'group') {
      info.hasAlternation = info.hasAlternation || atom.info.hasAlternation;
      info.hasQuantifier =
        info.hasQuantifier || atom.info.hasQuantifier || quantifier !== undefined;
    }
  }
}

type Atom = { kind: 'single' } | { kind: 'group'; info: GroupInfo };

function parseAtom(state: ParseState, depth: number): Atom {
  const ch = state.input[state.position];
  if (ch === '(') {
    state.position += 1;
    if (peek(state) === '?') {
      // only the non-capturing marker is allowed - no lookaround, no names
      if (state.input.startsWith('?:', state.position)) {
        state.position += 2;
      } else {
        throw new PatternError('lookaround and named groups are not allowed');
      }
    }
    const info = parseAlternation(state, depth + 1);
    if (peek(state) !== ')') throw new PatternError('unclosed group');
    state.position += 1;
    return { kind: 'group', info };
  }
  if (ch === '[') {
    parseCharacterClass(state);
    return { kind: 'single' };
  }
  if (ch === '\\') {
    state.position += 1;
    const escaped = state.input[state.position];
    if (escaped === undefined) throw new PatternError('dangling backslash');
    if (/[1-9]/.test(escaped)) throw new PatternError('backreferences are not allowed');
    if (escaped === 'k') throw new PatternError('named backreferences are not allowed');
    state.position += 1;
    return { kind: 'single' };
  }
  if (ch === '*' || ch === '+' || ch === '?') {
    throw new PatternError('quantifier without a target');
  }
  if (ch === '{') {
    // a brace that does not open a valid bound is treated as a literal by
    // JS, but authored content should not rely on that - reject it
    throw new PatternError("literal '{' must be escaped");
  }
  state.position += 1; // literal (includes '.', '^', '$')
  return { kind: 'single' };
}

function parseCharacterClass(state: ParseState): void {
  state.position += 1; // '['
  if (peek(state) === '^') state.position += 1;
  if (peek(state) === ']') state.position += 1; // leading ']' is a literal
  for (;;) {
    const ch = state.input[state.position];
    if (ch === undefined) throw new PatternError('unclosed character class');
    if (ch === ']') {
      state.position += 1;
      return;
    }
    if (ch === '\\') {
      state.position += 1;
      if (state.input[state.position] === undefined) {
        throw new PatternError('dangling backslash in class');
      }
    }
    state.position += 1;
  }
}

/** Consumes a quantifier if present and classifies it. */
function parseQuantifier(state: ParseState): QuantifierKind | undefined {
  const ch = peek(state);
  if (ch === '*' || ch === '+' || ch === '?') {
    const kind: QuantifierKind = ch === '?' ? 'optional' : 'unbounded';
    if (kind === 'unbounded') state.unbounded += 1;
    state.position += 1;
    if (peek(state) === '?') state.position += 1; // lazy marker is harmless
    return kind;
  }
  if (ch === '{') {
    const rest = state.input.slice(state.position);
    const match = /^\{(\d+)(?:,(\d*))?\}/.exec(rest);
    if (!match) throw new PatternError("literal '{' must be escaped");
    const low = Number(match[1]);
    let kind: QuantifierKind;
    if (match[2] === undefined) {
      // {n}
      if (low > MAX_BOUNDED_REPEAT) throw new PatternError('repetition bound too large');
      kind = low <= 1 ? 'optional' : 'bounded';
    } else if (match[2] === '') {
      // {n,} behaves like +, allowed with the same cap on n
      if (low > MAX_BOUNDED_REPEAT) throw new PatternError('repetition bound too large');
      state.unbounded += 1;
      kind = 'unbounded';
    } else {
      const high = Number(match[2]);
      if (high > MAX_BOUNDED_REPEAT) throw new PatternError('repetition bound too large');
      if (low > high) throw new PatternError('impossible repetition bounds');
      kind = high <= 1 ? 'optional' : 'bounded';
    }
    state.position += match[0].length;
    if (peek(state) === '?') state.position += 1;
    return kind;
  }
  return undefined;
}
