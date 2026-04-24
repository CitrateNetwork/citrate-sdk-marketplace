// Display formatters that match the Rust gateway's UX:
//   - grains_str_to_salt_display → "X.Y SALT" with comma separators
//
// We keep these in the SDK rather than the webapp because external
// integrators want the same canonical formatting.

const GRAINS_PER_SALT = 10n ** 18n;

/**
 * Format a grain (wei) bigint as `"X.Y SALT"`. Strips trailing zeros
 * in the fractional part; integer amounts render as `"5 SALT"` not
 * `"5.000000000000000000 SALT"`. Whole part gets comma separators
 * (e.g. `"1,234.5 SALT"`).
 */
export function grainsToSaltDisplay(grains: bigint): string {
  if (grains === 0n) return '0 SALT';
  const negative = grains < 0n;
  const abs = negative ? -grains : grains;
  const whole = abs / GRAINS_PER_SALT;
  const frac = abs % GRAINS_PER_SALT;
  const wholeStr = withCommas(whole.toString());
  const fracStr = frac === 0n ? '' : '.' + stripTrailingZeros(frac.toString().padStart(18, '0'));
  return (negative ? '-' : '') + wholeStr + fracStr + ' SALT';
}

/// Bare numeric SALT amount (no unit suffix), useful when callers
/// want to compose their own display.
export function grainsToSalt(grains: bigint): string {
  if (grains === 0n) return '0';
  const negative = grains < 0n;
  const abs = negative ? -grains : grains;
  const whole = abs / GRAINS_PER_SALT;
  const frac = abs % GRAINS_PER_SALT;
  const fracStr = frac === 0n ? '' : '.' + stripTrailingZeros(frac.toString().padStart(18, '0'));
  return (negative ? '-' : '') + whole.toString() + fracStr;
}

function withCommas(s: string): string {
  if (s.length <= 3) return s;
  const out: string[] = [];
  for (let i = s.length; i > 0; i -= 3) {
    out.unshift(s.slice(Math.max(0, i - 3), i));
  }
  return out.join(',');
}

function stripTrailingZeros(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === '0') end--;
  return end === 0 ? '0' : s.slice(0, end);
}
