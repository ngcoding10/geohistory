// Years and dates. Years are historical: no year 0, -44 means 44 BC.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export const MONTH_NAMES = MONTHS.map((m) => m[0].toUpperCase() + m.slice(1));

export const MIN_YEAR = -123000;
export const MAX_YEAR = new Date().getFullYear();

export function formatYear(y) {
  if (y == null) return '';
  return y < 0 ? `${(-y).toLocaleString('en-GB').replace(/,/g, ',')} BC` : String(y);
}

/** "4 July 1776", "July 1776", "1776", "44 BC" */
export function formatDate(y, m, d) {
  const yy = formatYear(y);
  if (m && d) return `${d} ${MONTH_NAMES[m - 1]} ${yy}`;
  if (m) return `${MONTH_NAMES[m - 1]} ${yy}`;
  return yy;
}

/** Move by n years, skipping the missing year 0. */
export function addYears(y, n) {
  const astro = y < 0 ? y + 1 : y;
  let a = astro + n;
  return a <= 0 ? a - 1 : a;
}

/** Number of years from a to b (b - a), knowing there is no year 0. */
export function yearDiff(a, b) {
  const aa = a < 0 ? a + 1 : a;
  const bb = b < 0 ? b + 1 : b;
  return bb - aa;
}

function monthOf(word) {
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return 0;
  const i = MONTHS.findIndex((m) => m.startsWith(w));
  return i + 1;
}

/**
 * Parse what someone typed. Returns { year, month?, day? } or { error }.
 * Accepts: 1776, 476, 44 BC, 44 BCE, -44, 1066 AD, AD 1066, 1066 CE, 4 July 1776, July 4 1776,
 * July 4, 1776, 1776-07-04, July 1776, 3000 bc, 10,000 BC.
 */
export function parseYear(input) {
  let s = String(input || '').trim().toLowerCase().replace(/(\d),(\d{3})/g, '$1$2').replace(/\s+/g, ' ');
  if (!s) return { error: 'Type a year, like 1776 or 44 BC.' };
  let era = 0; // -1 BC, +1 AD
  s = s.replace(/\b(b\.?\s?c\.?\s?e?\.?|bce)\s*$/, () => { era = -1; return ''; }).trim();
  s = s.replace(/^(a\.?\s?d\.?|ce)\s+/, () => { era = era || 1; return ''; }).trim();
  s = s.replace(/\s(a\.?\s?d\.?|c\.?e\.?)$/, () => { era = era || 1; return ''; }).trim();
  let year = null, month = 0, day = 0;
  let m;
  if ((m = s.match(/^(-?\d{1,6})-(\d{1,2})-(\d{1,2})$/))) {
    year = +m[1]; month = +m[2]; day = +m[3];
  } else if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)? (?:of )?([a-z.]+),? (-?\d{1,6})$/))) {
    day = +m[1]; month = monthOf(m[2]); year = +m[3];
    if (!month) return { error: `"${m[2]}" is not a month I know.` };
  } else if ((m = s.match(/^([a-z.]+) (\d{1,2})(?:st|nd|rd|th)?,? (-?\d{1,6})$/))) {
    month = monthOf(m[1]); day = +m[2]; year = +m[3];
    if (!month) return { error: `"${m[1]}" is not a month I know.` };
  } else if ((m = s.match(/^([a-z.]+),? (-?\d{1,6})$/))) {
    month = monthOf(m[1]); year = +m[2];
    if (!month) return { error: 'Type a year, like 1776 or 44 BC.' };
  } else if ((m = s.match(/^(-?\d{1,6})$/))) {
    year = +m[1];
  } else {
    return { error: 'Type a year, like 1776, 44 BC or 4 July 1776.' };
  }
  if (era === -1) year = -Math.abs(year);
  if (year === 0) return { error: 'There is no year 0. Try 1 BC or AD 1.' };
  if (month && (month < 1 || month > 12)) return { error: 'That month does not exist.' };
  if (day && (day < 1 || day > 31)) return { error: 'That day does not exist.' };
  if (year < MIN_YEAR) return { error: `The maps go back to ${formatYear(MIN_YEAR)}.` };
  if (year > MAX_YEAR) return { error: `That is in the future. Try ${MAX_YEAR} or earlier.` };
  const out = { year };
  if (month) out.month = month;
  if (day) out.day = day;
  return out;
}

// ---- timeline scale: piecewise, so recent centuries get more room than deep prehistory ----
const STOPS = [
  [MIN_YEAR, 0], [-10000, 0.03], [-3000, 0.1], [-500, 0.25], [500, 0.4], [1000, 0.5],
  [1500, 0.64], [1800, 0.8], [1900, 0.9], [MAX_YEAR, 1],
];
export const ERAS = [
  { y: -10000, label: 'Stone Age', short: '' }, { y: -3000, label: 'Bronze Age', short: '3000 BC' },
  { y: -500, label: 'Classical', short: '500 BC' }, { y: 500, label: 'Middle Ages', short: 'AD 500' },
  { y: 1500, label: 'Early modern', short: '1500' }, { y: 1800, label: 'Modern', short: '1800' },
  { y: 1900, label: '1900s', short: '1900' },
];

export function yearToFrac(y) {
  for (let i = 1; i < STOPS.length; i++) {
    const [y0, f0] = STOPS[i - 1], [y1, f1] = STOPS[i];
    if (y <= y1) return f0 + ((Math.max(y, y0) - y0) / (y1 - y0)) * (f1 - f0);
  }
  return 1;
}

export function fracToYear(f) {
  for (let i = 1; i < STOPS.length; i++) {
    const [y0, f0] = STOPS[i - 1], [y1, f1] = STOPS[i];
    if (f <= f1) {
      let y = y0 + ((f - f0) / (f1 - f0)) * (y1 - y0);
      const step = y < -10000 ? 1000 : y < -3000 ? 100 : y < -500 ? 10 : 1;
      y = Math.round(y / step) * step;
      if (y === 0) y = 1;
      return Math.max(MIN_YEAR, Math.min(MAX_YEAR, y));
    }
  }
  return MAX_YEAR;
}
