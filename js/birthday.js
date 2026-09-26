// Compleanno (SPEC §8): "AAAA-MM-GG" o "--MM-GG" → "12 marzo 1980 (46 anni)", "tra 5 giorni", "oggi!".
// Stesse regole del profilo sul PC (app/web/js/screens/field-editors.js), qui senza dipendenze dall'interfaccia.
import { MONTHS, daysBetween, parsePartialDate, todayISO } from './pc/format.js';

const pad2 = (n) => String(n).padStart(2, '0');
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** { year|null, month, day } se il valore è un compleanno con giorno e mese, altrimenti null. */
export function parseBirthday(value) {
  const p = parsePartialDate(typeof value === 'string' ? value : '', { allowNoYear: true });
  if (!p || !p.month || !p.day) return null;
  return { year: p.year, month: p.month, day: p.day };
}

export function birthdayInfo(value, today = todayISO()) {
  const b = parseBirthday(value);
  const t = parsePartialDate(today);
  if (!b || !t || t.precision !== 'day') return null;
  const occurrence = (y) => `${String(y).padStart(4, '0')}-${pad2(b.month)}-${pad2(b.month === 2 && b.day === 29 && !isLeap(y) ? 28 : b.day)}`;
  const thisYear = occurrence(t.year);
  const next = thisYear >= today ? thisYear : occurrence(t.year + 1);
  let age = null;
  if (b.year) {
    age = t.year - b.year - (thisYear > today ? 1 : 0);
    if (age < 0) age = null;
  }
  const dayMonth = `${b.day} ${MONTHS[b.month - 1]}`;
  return { ...b, age, next, daysUntil: daysBetween(today, next), dayMonth, text: b.year ? `${dayMonth} ${b.year}` : dayMonth };
}

const ageText = (age) => (age === 0 ? 'meno di un anno' : age === 1 ? '1 anno' : `${age} anni`);

/** "12 marzo 1980 (46 anni)" | "12 marzo" | "" */
export function birthdayLabel(value, { withYear = true, today } = {}) {
  const info = birthdayInfo(value, today);
  if (!info) return '';
  const base = withYear ? info.text : info.dayMonth;
  return info.age !== null ? `${base} (${ageText(info.age)})` : base;
}

/** "oggi!" | "domani" | "tra N giorni" se cade entro `within` giorni, altrimenti "". */
export function birthdayCountdown(value, { within = 30, today } = {}) {
  const info = birthdayInfo(value, today);
  if (!info || info.daysUntil > within) return '';
  if (info.daysUntil === 0) return 'oggi!';
  if (info.daysUntil === 1) return 'domani';
  return `tra ${info.daysUntil} giorni`;
}
