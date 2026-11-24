// Exact rational arithmetic used for the verifiable witnesses and dual
// certificates. All user-facing numbers are parsed as exact decimals so that
// rounding intervals such as 3.2 ± 0.05 stay exact.

export interface Rat {
  readonly n: bigint;
  readonly d: bigint;
}

export const ZERO: Rat = { n: 0n, d: 1n };
export const ONE: Rat = { n: 1n, d: 1n };

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

export function makeRat(n: bigint, d: bigint = 1n): Rat {
  if (d === 0n) throw new Error('rational: division by zero');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  if (n === 0n) return ZERO;
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export function rat(n: number | bigint, d: number | bigint = 1n): Rat {
  if (typeof n === 'bigint' || Number.isInteger(n)) {
    if (typeof d === 'bigint' || Number.isInteger(d)) return makeRat(BigInt(n), BigInt(d));
  }
  // Decimal shorthand: rat(0.25) -> 1/4 via the shortest decimal rendering.
  const num = fromNumber(Number(n));
  if (d === 1n) return num;
  return div(num, fromNumber(Number(d)));
}

/** Parse a plain decimal string (e.g. "3.2", "-0.05", "1e-3"). Exact. */
export function parseDecimal(text: string): Rat | null {
  const s = text.trim();
  if (!s) return null;
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m) return null;
  const [, sign, whole, frac = '', expStr] = m;
  if (!whole && !frac) return null;
  let n = BigInt((whole || '0') + frac);
  if (sign === '-') n = -n;
  let scale = BigInt(frac.length);
  if (expStr) {
    const e = Number(expStr);
    if (!Number.isSafeInteger(e) || Math.abs(e) > 400) return null;
    scale -= BigInt(e);
  }
  if (scale >= 0n) return makeRat(n, 10n ** scale);
  return makeRat(n * 10n ** -scale, 1n);
}

export function fromNumber(x: number): Rat {
  if (!Number.isFinite(x)) throw new Error('rational: non-finite number');
  return parseDecimal(String(x)) ?? ZERO;
}

export function add(a: Rat, b: Rat): Rat {
  return makeRat(a.n * b.d + b.n * a.d, a.d * b.d);
}
export function sub(a: Rat, b: Rat): Rat {
  return makeRat(a.n * b.d - b.n * a.d, a.d * b.d);
}
export function mul(a: Rat, b: Rat): Rat {
  return makeRat(a.n * b.n, a.d * b.d);
}
export function div(a: Rat, b: Rat): Rat {
  if (b.n === 0n) throw new Error('rational: division by zero');
  return makeRat(a.n * b.d, a.d * b.n);
}
export function neg(a: Rat): Rat {
  return { n: -a.n, d: a.d };
}
export function abs(a: Rat): Rat {
  return a.n < 0n ? neg(a) : a;
}

export function cmp(a: Rat, b: Rat): number {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l === r ? 0 : l < r ? -1 : 1;
}
export const eq = (a: Rat, b: Rat): boolean => a.n === b.n && a.d === b.d;
export const lt = (a: Rat, b: Rat): boolean => cmp(a, b) < 0;
export const le = (a: Rat, b: Rat): boolean => cmp(a, b) <= 0;
export const isZero = (a: Rat): boolean => a.n === 0n;
export const sign = (a: Rat): number => (a.n === 0n ? 0 : a.n < 0n ? -1 : 1);

export function max2(a: Rat, b: Rat): Rat {
  return cmp(a, b) >= 0 ? a : b;
}
export function min2(a: Rat, b: Rat): Rat {
  return cmp(a, b) <= 0 ? a : b;
}

export function toNumber(a: Rat): number {
  return Number(a.n) / Number(a.d);
}

/** Exact decimal rendering with at most `digits` fractional digits (truncated toward zero). */
export function toDecimalString(a: Rat, digits = 6): string {
  if (a.n === 0n) return '0';
  const negFlag = a.n < 0n;
  const n = negFlag ? -a.n : a.n;
  const scale = 10n ** BigInt(digits);
  const q = (n * scale) / a.d;
  let whole = q / scale;
  let frac = (q % scale).toString().padStart(digits, '0').replace(/0+$/, '');
  // Round-half-away-from-zero correction is unnecessary for display purposes;
  // we append the residual marker only in the exact-fraction tooltip.
  const body = frac ? `${whole}.${frac}` : `${whole}`;
  return negFlag ? `-${body}` : body;
}

/** A compact exact fraction for tooltips / copyable evidence. */
export function toFraction(a: Rat): string {
  return a.d === 1n ? `${a.n}` : `${a.n}/${a.d}`;
}

/** Human percentage with `digits` fractional digits, e.g. "37.5%". */
export function toPercentString(a: Rat, digits = 3): string {
  const scaled = mul(a, rat(100));
  return `${toDecimalString(scaled, digits)}%`;
}

export function parseDecimalOrThrow(text: string, label: string): Rat {
  const r = parseDecimal(text);
  if (!r) throw new Error(`${label}: 无法解析数值「${text}」`);
  return r;
}

export function sum(xs: Rat[]): Rat {
  return xs.reduce((acc, x) => add(acc, x), ZERO);
}
