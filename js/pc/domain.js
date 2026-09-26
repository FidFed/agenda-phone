// Regole di dominio lato client: funzioni pure su Archive/Person/Group/Event (vedi SPEC §4 e §6).
// Nessuna dipendenza dallo store: ricevono sempre l'archivio come parametro.
// Documentazione: docs/frontend.md

import { MONTHS, todayISO, addDays, compareDates, formatDate, isValidPartialDate, parsePartialDate } from './format.js';

// ---------------------------------------------------------------------------
// Utilità generali
// ---------------------------------------------------------------------------

const collator = new Intl.Collator('it', { sensitivity: 'base', numeric: true });

/** Confronto di testi in italiano (senza distinzione di maiuscole/accenti, numeri naturali). */
export function compareText(a, b) {
  return collator.compare(String(a ?? ''), String(b ?? ''));
}

/** Nuovo ID entità (UUID v4). */
export function newId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Hash stabile (FNV-1a 32 bit) di una stringa: usato per colori di default. */
export function hashString(s) {
  let h = 0x811c9dc5;
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const objValues = (o) => (o && typeof o === 'object' ? Object.values(o) : []);

// ---------------------------------------------------------------------------
// Nomi
// ---------------------------------------------------------------------------

/** "Nome Cognome" | soprannome | "(senza nome)". */
export function displayName(person) {
  if (!person) return '(senza nome)';
  const name = [str(person.firstName).trim(), str(person.lastName).trim()].filter(Boolean).join(' ');
  if (name) return name;
  const nick = str(person.nickname).trim();
  return nick || '(senza nome)';
}

/** "Nome Cognome (soprannome)"; senza nome → soprannome; niente duplicati. */
export function fullName(person) {
  if (!person) return '(senza nome)';
  const name = [str(person.firstName).trim(), str(person.lastName).trim()].filter(Boolean).join(' ');
  const nick = str(person.nickname).trim();
  if (name && nick && nick.toLocaleLowerCase('it') !== name.toLocaleLowerCase('it')) return `${name} (${nick})`;
  return name || nick || '(senza nome)';
}

/** Iniziali (max 2 lettere, maiuscole): "Mario Rossi" → "MR"; solo soprannome → prime lettere; nulla → "?". */
export function initials(person) {
  const first = (s) => Array.from(str(s).trim())[0] || '';
  const f = first(person?.firstName);
  const l = first(person?.lastName);
  let out = (f + l);
  if (!out) {
    const words = str(person?.nickname).trim().split(/\s+/).filter(Boolean);
    out = words.slice(0, 2).map(first).join('');
  }
  return out ? out.toLocaleUpperCase('it') : '?';
}

/** Iniziali di un nome qualsiasi (gruppi, eventi): "Studio Bianchi" → "SB". */
export function initialsOf(name) {
  const words = str(name).trim().split(/\s+/).filter(Boolean);
  const out = words.slice(0, 2).map((w) => Array.from(w)[0] || '').join('');
  return out ? out.toLocaleUpperCase('it') : '?';
}

// ---------------------------------------------------------------------------
// Schema e valori dei campi
// ---------------------------------------------------------------------------

/** Campo con il ruolo indicato, o null. */
export function fieldByRole(schema, role) {
  return schema?.fields?.find((f) => f && f.role === role) || null;
}

/** Campo per id, o null. */
export function fieldById(schema, id) {
  return schema?.fields?.find((f) => f && f.id === id) || null;
}

/** Campi di una sezione, nell'ordine dello schema. */
export function fieldsOfSection(schema, sectionId) {
  return (schema?.fields || []).filter((f) => f && f.sectionId === sectionId);
}

/** true se il valore è "vuoto" (chiave mancante, "", [], null, PersonRef vuota). `false` NON è vuoto. */
export function isEmptyValue(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'number') return !Number.isFinite(value);
  if (typeof value === 'boolean') return false;
  if (Array.isArray(value)) return value.every(isEmptyValue);
  if (typeof value === 'object') {
    if ('personId' in value) return !value.personId;
    if ('text' in value) return str(value.text).trim() === '';
    return Object.keys(value).length === 0;
  }
  return false;
}

/** Nome leggibile di una PersonRef ({personId} | {text}). */
export function personRefText(archive, ref) {
  if (!ref || typeof ref !== 'object') return '';
  if (ref.personId) {
    const p = archive?.people?.[ref.personId];
    return p ? displayName(p) : '(persona eliminata)';
  }
  return str(ref.text).trim();
}

/** true se la PersonRef punta alla persona `personId`. */
export function refersTo(ref, personId) {
  return !!ref && typeof ref === 'object' && ref.personId === personId;
}

/** Valore di un campo come testo leggibile (per viste e ricerca). Vuoto → "". */
export function fieldValueText(archive, field, value) {
  if (isEmptyValue(value)) return '';
  const type = field?.type || 'text';
  switch (type) {
    case 'text':
    case 'longtext':
    case 'url':
    case 'choice':
      return Array.isArray(value) ? value.map(str).join(', ') : str(value);
    case 'date':
      return formatDate(str(value), { style: 'long' });
    case 'number':
      return typeof value === 'number' ? value.toLocaleString('it-IT') : str(value);
    case 'multichoice':
      return (Array.isArray(value) ? value : [value]).map(str).filter(Boolean).join(', ');
    case 'bool':
      return value === true ? 'Sì' : value === false ? 'No' : str(value);
    case 'person':
      return Array.isArray(value)
        ? value.map((r) => personRefText(archive, r)).filter(Boolean).join(', ')
        : personRefText(archive, value);
    case 'people':
      return (Array.isArray(value) ? value : [value]).map((r) => personRefText(archive, r)).filter(Boolean).join(', ');
    default:
      if (Array.isArray(value)) return value.map((v) => (typeof v === 'object' ? personRefText(archive, v) : str(v))).join(', ');
      if (typeof value === 'object') return personRefText(archive, value);
      return str(value);
  }
}

/** Testo del campo con ruolo `role` per la persona ("" se assente). */
export function roleText(archive, person, role) {
  const f = fieldByRole(archive?.schema, role);
  return f ? fieldValueText(archive, f, person?.fields?.[f.id]) : '';
}

/** "Lavoro · Città" dai campi con ruolo job/city (parti vuote omesse). */
export function personSubtitle(archive, person) {
  return [roleText(archive, person, 'job'), roleText(archive, person, 'city')]
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' · ');
}

// ---------------------------------------------------------------------------
// Relazioni: eventi, gruppi, backlink
// ---------------------------------------------------------------------------

// Ordine per data decrescente; date vuote o non valide in fondo; a parità, creazione più recente prima.
const validDate = (d) => (parsePartialDate(str(d)) ? str(d) : '');
const byDateDesc = (da, db, ca, cb) => {
  const va = validDate(da);
  const vb = validDate(db);
  if (va && !vb) return -1;
  if (!va && vb) return 1;
  if (va !== vb) return -compareDates(va, vb);
  return str(cb).localeCompare(str(ca));
};

/** Eventi a cui la persona ha partecipato: [{ event, note }] per data decrescente (senza data in fondo). */
export function eventsOfPerson(archive, personId) {
  const out = [];
  for (const event of objValues(archive?.events)) {
    const part = (event?.participants || []).find((p) => p && p.personId === personId);
    if (part) out.push({ event, note: str(part.note) });
  }
  return out.sort((a, b) => byDateDesc(a.event.date, b.event.date, a.event.createdAt, b.event.createdAt));
}

/** Gruppi di cui la persona fa parte: [{ group, role }] in ordine di nome. */
export function groupsOfPerson(archive, personId) {
  const out = [];
  for (const group of objValues(archive?.groups)) {
    const m = (group?.members || []).find((x) => x && x.personId === personId);
    if (m) out.push({ group, role: str(m.role) });
  }
  return out.sort((a, b) => compareText(a.group.name, b.group.name));
}

/** Membri di un gruppo risolti: [{ person, role }] (persone mancanti ignorate), in ordine di nome. */
export function groupMembers(archive, group) {
  return (group?.members || [])
    .map((m) => ({ person: archive?.people?.[m?.personId], role: str(m?.role) }))
    .filter((x) => x.person)
    .sort((a, b) => compareText(displayName(a.person), displayName(b.person)));
}

/** Partecipanti di un evento risolti: [{ person, note }] (persone mancanti ignorate), nell'ordine salvato. */
export function eventParticipants(archive, event) {
  return (event?.participants || [])
    .map((p) => ({ person: archive?.people?.[p?.personId], note: str(p?.note) }))
    .filter((x) => x.person);
}

/**
 * Campo di destinazione di un campo reciproco (v1.5, SPEC §12): sé stesso per `reciprocal: "self"`, il campo inverso
 * per una coppia (Figli ↔ Genitori); null se il campo non è reciproco. Stessa regola di `reciprocalTarget` del server.
 */
export function reciprocalTarget(schema, field) {
  if (!field || (field.type !== 'person' && field.type !== 'people') || !field.reciprocal) return null;
  if (field.reciprocal === 'self') return field;
  const t = fieldById(schema, field.reciprocal);
  return t && (t.type === 'person' || t.type === 'people') ? t : null;
}

/**
 * Chi cita la persona in campi di tipo person/people: [{ person, field }] in ordine di nome. Con `hideReciprocal`
 * (profilo, «Citato da») si saltano i collegamenti di campi reciproci già visibili nel campo della persona stessa.
 */
export function backlinks(archive, personId, { hideReciprocal = false } = {}) {
  const refFields = (archive?.schema?.fields || []).filter((f) => f && (f.type === 'person' || f.type === 'people'));
  if (!refFields.length) return [];
  const own = archive?.people?.[personId]?.fields || {};
  const out = [];
  for (const person of objValues(archive?.people)) {
    if (!person || person.id === personId) continue;
    for (const field of refFields) {
      const v = person.fields?.[field.id];
      const refs = Array.isArray(v) ? v : v ? [v] : [];
      if (!refs.some((r) => refersTo(r, personId))) continue;
      // Campo reciproco (v1.5) già visibile sul profilo: se X cita questa persona in «Partner» e lei ha X nel
      // campo di destinazione, «Citato da» lo ripeterebbe.
      if (hideReciprocal) {
        const target = reciprocalTarget(archive.schema, field);
        const mine = target ? own[target.id] : undefined;
        if (target && (Array.isArray(mine) ? mine : mine ? [mine] : []).some((r) => refersTo(r, person.id))) continue;
      }
      out.push({ person, field });
    }
  }
  return out.sort((a, b) => compareText(displayName(a.person), displayName(b.person)) || compareText(a.field.label, b.field.label));
}

/** Ultima volta vista: evento con data più recente non futura → { date, event } | null. */
export function lastSeen(archive, personId, today = todayISO()) {
  for (const { event } of eventsOfPerson(archive, personId)) {
    const d = str(event.date);
    if (!parsePartialDate(d)) continue;
    if (d.slice(0, Math.min(d.length, 10)) <= today.slice(0, d.length)) return { date: d, event };
  }
  return null;
}

/**
 * Primo incontro: { date, place, context, introducedBy, event, fromEvent }.
 * I valori vengono dai campi con ruolo firstMeetingDate/Place/Context/introducedBy; le parti vuote sono completate
 * con l'evento del primo incontro (firstMeetingEvent) se c'è — mai con un altro evento, per non mescolare due
 * incontri. Solo per le schede di prima della v1.3 (senza `firstMeetingEventId`, vedi hasFirstMeetingChoice) resta il
 * vecchio aiuto: l'evento più vecchio a cui la persona ha partecipato. Una scheda con "nessun evento" (tolto nel
 * modulo, «Annulla» dopo la compilazione automatica) non si vede attribuire un evento che l'utente ha scartato.
 * (event = l'evento usato, fromEvent = true se ha completato qualcosa.)
 */
export function firstMet(archive, person) {
  const schema = archive?.schema;
  const val = (role) => {
    const f = fieldByRole(schema, role);
    return f ? person?.fields?.[f.id] : undefined;
  };
  const date = str(val('firstMeetingDate'));
  const place = str(val('firstMeetingPlace'));
  const context = str(val('firstMeetingContext'));
  const intro = val('introducedBy');
  const introducedBy = Array.isArray(intro) ? (intro.find((r) => !isEmptyValue(r)) || null) : (isEmptyValue(intro) ? null : intro);

  const result = { date, place, context, introducedBy, event: null, fromEvent: false };
  if (date && place && context) return result;

  const linked = person ? firstMeetingEvent(archive, person) : null;
  const events = person && !linked && !hasFirstMeetingChoice(person)
    ? eventsOfPerson(archive, person.id).filter((x) => parsePartialDate(str(x.event.date))) : [];
  const oldest = linked || (events.length ? events[events.length - 1].event : null);
  if (oldest) {
    result.event = oldest;
    if (!result.date && oldest.date) { result.date = oldest.date; result.fromEvent = true; }
    if (!result.place && oldest.place) { result.place = oldest.place; result.fromEvent = true; }
    if (!result.context && oldest.title) { result.context = oldest.title; result.fromEvent = true; }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Primo incontro da un evento (SPEC §10). Stesse regole di putEvent sul server (app/lib/archive.js: fillsOf e
// fromThisEvent): se cambiano là, vanno cambiate anche qui (tests/unit/dominio-frontend.test.js le confronta).
// ---------------------------------------------------------------------------

/**
 * Data parziale in forma leggibile, identica a readableDate del server: "12 maggio 2019", "maggio 2019", "2019",
 * "12 marzo" (senza anno). È il testo che un evento scrive in un campo "data del primo incontro" che non è di tipo
 * data. Input non valido → restituito così com'è.
 */
export function readablePartialDate(partial) {
  const s = str(partial);
  if (!isValidPartialDate(s) || s !== s.trim()) return s;
  if (s.startsWith('--')) return `${Number(s.slice(5, 7))} ${MONTHS[Number(s.slice(2, 4)) - 1]}`;
  const [y, m, d] = s.split('-');
  if (!m) return y;
  if (!d) return `${MONTHS[Number(m) - 1]} ${y}`;
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/**
 * Campi del primo incontro che un evento può compilare: { date, place, context } (Field oppure null).
 * Come il server: il ruolo deve avere un tipo compatibile (data: date/text/longtext; luogo e contesto: text/longtext).
 */
export function firstMeetingFillFields(schema) {
  const pick = (role, types) => {
    const f = fieldByRole(schema, role);
    return f && types.includes(f.type) ? f : null;
  };
  return {
    date: pick('firstMeetingDate', ['date', 'text', 'longtext']),
    place: pick('firstMeetingPlace', ['text', 'longtext']),
    context: pick('firstMeetingContext', ['text', 'longtext']),
  };
}

/**
 * Valori che l'evento scrive nel primo incontro, come `fillsOf` di putEvent: [[fieldId, valore], …], solo quelli
 * non vuoti, nell'ordine data, luogo, contesto (= titolo). La data va com'è in un campo di tipo data, in forma
 * leggibile ("5 ottobre 2024") in un campo di testo.
 */
export function firstMeetingFills(schema, event) {
  const out = [];
  if (!event) return out;
  const { date, place, context } = firstMeetingFillFields(schema);
  const d = str(event.date);
  const p = str(event.place);
  const t = str(event.title);
  if (date && d) out.push([date.id, date.type === 'date' ? d : readablePartialDate(d)]);
  if (place && p) out.push([place.id, p]);
  if (context && t) out.push([context.id, t]);
  return out;
}

// true se l'evento `a` viene prima di `b`: prima quelli con una data valida, poi la data più vecchia, poi il creato prima.
function isEarlierEvent(a, b) {
  const va = validDate(a?.date);
  const vb = validDate(b?.date);
  if (va && !vb) return true;
  if (!va && vb) return false;
  if (va !== vb) return compareDates(va, vb) < 0;
  return str(a?.createdAt) < str(b?.createdAt);
}

// Vuoto come lo intende il server (isEmpty di archive.js): una stringa di soli spazi NON è vuota.
const serverEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
/** Valore della persona uguale a quello scritto dall'evento (come `sameFill` di putEvent: spazi ai bordi ignorati). */
export const sameFill = (cur, value) => typeof cur === 'string' && value !== undefined && cur.trim() === value;
const takesPart = (event, personId) => (event?.participants || []).some((p) => p && p.personId === personId);

/**
 * Per le schede di prima della v1.3 (senza `firstMeetingEventId`), come `derivedFirstMeetingEventId` del server:
 * l'evento di cui la persona è partecipante da cui vengono TUTTI i suoi valori compilati del primo incontro (niente
 * scritto a mano, niente preso da un altro evento). Tra più eventi possibili vince quello di cui ha tutti i valori
 * (poi quello a cui ne manca meno), poi il più vecchio.
 */
export function derivedFirstMeetingEvent(archive, person) {
  if (!person?.id) return null;
  const schema = archive?.schema;
  const ff = firstMeetingFillFields(schema);
  const fields = person.fields || {};
  const filled = [ff.date, ff.place, ff.context].filter((f) => f && !serverEmpty(fields[f.id]));
  if (!filled.length) return null;
  let best = null;
  let bestMissing = Infinity;
  for (const event of objValues(archive?.events)) {
    if (!event || !takesPart(event, person.id)) continue;
    const fills = firstMeetingFills(schema, event);
    const map = new Map(fills);
    if (!filled.every((f) => sameFill(fields[f.id], map.get(f.id)))) continue;
    const missing = fills.length - filled.length;
    if (missing < bestMissing || (missing === bestMissing && isEarlierEvent(event, best))) {
      best = event;
      bestMissing = missing;
    }
  }
  return best;
}

/**
 * Evento del primo incontro della persona, oppure null (SPEC §10). Di norma è quello salvato nella scheda
 * (`firstMeetingEventId`: scelto nel modulo, o l'evento che ha compilato un primo incontro vuoto), purché esista e la
 * persona ne sia partecipante; "" = nessun evento. Le schede di prima della v1.3 non hanno il collegamento: lo si
 * ricava dai valori (derivedFirstMeetingEvent). Il server usa la stessa regola per far seguire al primo incontro le
 * correzioni di data, luogo e titolo dell'evento.
 */
export function firstMeetingEvent(archive, person) {
  if (!person?.id) return null;
  if (typeof person.firstMeetingEventId === 'string') return linkedFirstMeetingEvent(archive, person);
  return derivedFirstMeetingEvent(archive, person);
}

/**
 * true se la scheda dice lei qual è l'evento del primo incontro (v1.3: `firstMeetingEventId` presente, anche "" =
 * nessun evento). Allora il primo incontro si completa solo con quell'evento, mai con "l'evento più vecchio" (firstMet
 * e le sue versioni veloci negli elenchi e nel ripasso, il segno "Primo incontro" nei partecipanti di un evento).
 */
export function hasFirstMeetingChoice(person) {
  return typeof person?.firstMeetingEventId === 'string';
}

/**
 * Solo l'evento salvato nella scheda (`firstMeetingEventId`), se esiste e la persona ne è partecipante, altrimenti null.
 * Veloce (nessuna scansione degli eventi): per elenchi lunghi che completano il primo incontro con un evento.
 */
export function linkedFirstMeetingEvent(archive, person) {
  const link = person?.firstMeetingEventId;
  const event = typeof link === 'string' && link ? archive?.events?.[link] : null;
  return event && takesPart(event, person.id) ? event : null;
}

// ---------------------------------------------------------------------------
// Tag
// ---------------------------------------------------------------------------

// Caratteri di controllo (tranne \t \n \r): gli stessi che il server toglie (app/lib/archive.js, CONTROL_RE).
const TAG_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g; // eslint-disable-line no-control-regex
const TAG_MAX = 60; // unità UTF-16, come LIMITS.tag del server

/**
 * Normalizza un tag per la visualizzazione/salvataggio ESATTAMENTE come il server (app/lib/archive.js normalizeTag):
 * forma NFC, caratteri di controllo tolti, spazi collassati, trim, max 60 unità UTF-16 senza spezzare una coppia
 * surrogata. Così la chiave (tagKey) di un tag appena scritto o incollato coincide con quella del tag salvato.
 */
export function normalizeTag(s) {
  let t = str(s).normalize('NFC').replace(TAG_CONTROL_RE, '').replace(/\s+/g, ' ').trim();
  if (t.length > TAG_MAX) {
    t = t.slice(0, TAG_MAX);
    const last = t.charCodeAt(t.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) t = t.slice(0, -1);
  }
  return t.trim();
}

/** Chiave di confronto di un tag (case-insensitive in italiano). */
export function tagKey(s) {
  return normalizeTag(s).toLocaleLowerCase('it');
}

/** true se due tag sono lo stesso tag (confronto case-insensitive). */
export function sameTag(a, b) {
  return tagKey(a) === tagKey(b);
}

/** true se la lista `tags` contiene `tag` (case-insensitive). */
export function hasTag(tags, tag) {
  const k = tagKey(tag);
  return Array.isArray(tags) && tags.some((t) => tagKey(t) === k);
}

/** Aggiunge tag a una lista senza duplicati (case-insensitive), normalizzandoli. */
export function addTags(tags, ...more) {
  const out = Array.isArray(tags) ? tags.map(normalizeTag).filter(Boolean) : [];
  for (const t of more.flat()) {
    const n = normalizeTag(t);
    if (n && !hasTag(out, n)) out.push(n);
  }
  return out;
}

/** Colore esplicito del tag (0..7) dal tagMeta, o null. */
export function tagCustomColor(archive, name) {
  const meta = archive?.tagMeta;
  if (!meta) return null;
  const direct = meta[name];
  if (direct && Number.isInteger(direct.color)) return direct.color;
  const k = tagKey(name);
  for (const [n, m] of Object.entries(meta)) {
    if (tagKey(n) === k && m && Number.isInteger(m.color)) return m.color;
  }
  return null;
}

/** Colore effettivo del tag (0..7): esplicito dal tagMeta oppure derivato dal nome. */
export function tagColor(archive, name) {
  const c = tagCustomColor(archive, name);
  return c !== null && c >= 0 && c <= 7 ? c : hashString(tagKey(name)) % 8;
}

/** Tutti i tag usati: [{ name, count, peopleCount, groupsCount, eventsCount, color, customColor }] in ordine alfabetico. */
export function allTags(archive) {
  const map = new Map();
  const add = (tags, kind) => {
    const seen = new Set();
    for (const t of tags || []) {
      const name = normalizeTag(t);
      const k = name.toLocaleLowerCase('it');
      if (!name || seen.has(k)) continue;
      seen.add(k);
      let e = map.get(k);
      if (!e) { e = { name, count: 0, peopleCount: 0, groupsCount: 0, eventsCount: 0 }; map.set(k, e); }
      e.count++;
      e[kind]++;
    }
  };
  for (const p of objValues(archive?.people)) add(p?.tags, 'peopleCount');
  for (const g of objValues(archive?.groups)) add(g?.tags, 'groupsCount');
  for (const e of objValues(archive?.events)) add(e?.tags, 'eventsCount');
  return Array.from(map.values())
    .map((e) => ({ ...e, customColor: tagCustomColor(archive, e.name), color: tagColor(archive, e.name) }))
    .sort((a, b) => compareText(a.name, b.name));
}

/** Persone con il tag (case-insensitive), in ordine di nome. */
export function peopleWithTag(archive, tag) {
  return sortPeople(objValues(archive?.people).filter((p) => hasTag(p?.tags, tag)), 'nome');
}

/** Gruppi con il tag, in ordine di nome. */
export function groupsWithTag(archive, tag) {
  return objValues(archive?.groups).filter((g) => hasTag(g?.tags, tag)).sort((a, b) => compareText(a.name, b.name));
}

/** Eventi con il tag, per data decrescente. */
export function eventsWithTag(archive, tag) {
  return objValues(archive?.events).filter((e) => hasTag(e?.tags, tag)).sort((a, b) => byDateDesc(a.date, b.date, a.createdAt, b.createdAt));
}

// ---------------------------------------------------------------------------
// Liste e ordinamenti
// ---------------------------------------------------------------------------

/**
 * Ordina persone (restituisce un nuovo array).
 *   "nome"       → nome, poi cognome
 *   "cognome"    → cognome, poi nome
 *   "recenti"    → aggiunte più di recente (createdAt decrescente)
 *   "visti"      → viste più di recente (ultimo evento); richiede `archive`
 *   "conosciuti" → conosciute più di recente (data primo incontro); richiede `archive`
 * Le persone senza data finiscono in fondo, ordinate per nome.
 */
export function sortPeople(list, by = 'nome', archive = null) {
  const arr = Array.isArray(list) ? list.filter(Boolean) : [];
  const byName = (a, b) =>
    compareText(a.firstName || a.nickname || a.lastName, b.firstName || b.nickname || b.lastName) ||
    compareText(a.lastName, b.lastName) || compareText(a.nickname, b.nickname);
  const bySurname = (a, b) =>
    compareText(a.lastName || a.firstName || a.nickname, b.lastName || b.firstName || b.nickname) ||
    compareText(a.firstName, b.firstName) || compareText(a.nickname, b.nickname);
  const descBy = (keyFn) => {
    const keys = new Map(arr.map((p) => [p, keyFn(p) || '']));
    return (a, b) => {
      const ka = keys.get(a);
      const kb = keys.get(b);
      if (ka && !kb) return -1;
      if (!ka && kb) return 1;
      if (ka !== kb) return ka < kb ? 1 : -1;
      return byName(a, b);
    };
  };
  switch (by) {
    case 'cognome': return arr.sort(bySurname);
    case 'recenti': return arr.sort(descBy((p) => str(p.createdAt)));
    case 'visti': return arr.sort(descBy((p) => (archive ? lastSeen(archive, p.id)?.date : '') || ''));
    case 'conosciuti': return arr.sort(descBy((p) => {
      const d = archive ? firstMet(archive, p).date : '';
      return parsePartialDate(d) ? d : '';
    }));
    case 'nome':
    default: return arr.sort(byName);
  }
}

/** Tutte le persone in ordine di nome. */
export function listPeople(archive, by = 'nome') {
  return sortPeople(objValues(archive?.people), by, archive);
}

/** Tutti i gruppi in ordine di nome. */
export function listGroups(archive) {
  return objValues(archive?.groups).filter(Boolean).sort((a, b) => compareText(a.name, b.name));
}

/** Tutti gli eventi per data decrescente. */
export function listEvents(archive) {
  return objValues(archive?.events).filter(Boolean).sort((a, b) => byDateDesc(a.date, b.date, a.createdAt, b.createdAt));
}

// ---------------------------------------------------------------------------
// File e immagini
// ---------------------------------------------------------------------------

/** URL del contenuto (decifrato) di un file. Con { download: true } forza il download. */
export function fileUrl(fileId, { download = false } = {}) {
  if (!fileId) return '';
  return `/api/files/${encodeURIComponent(fileId)}${download ? '?download=1' : ''}`;
}

/** URL della miniatura principale (prima foto) di persona/gruppo/evento, o null. */
export function thumbUrl(entity) {
  const ref = Array.isArray(entity?.photos) ? entity.photos.find((p) => p && (p.thumbId || p.fileId)) : null;
  if (!ref) return null;
  return fileUrl(ref.thumbId || ref.fileId);
}

/** URL della foto principale a piena risoluzione, o null. */
export function photoUrl(entity) {
  const ref = Array.isArray(entity?.photos) ? entity.photos.find((p) => p && (p.fileId || p.thumbId)) : null;
  if (!ref) return null;
  return fileUrl(ref.fileId || ref.thumbId);
}

// ---------------------------------------------------------------------------
// Ripasso (Leitner)
// ---------------------------------------------------------------------------

/** Intervalli in giorni per box Leitner. */
export const LEITNER_INTERVALS = Object.freeze({ 1: 1, 2: 3, 3: 7, 4: 16, 5: 35 });

/** true se la persona è GIÀ stata ripassata e la sua scadenza è oggi o passata. */
export function reviewDue(archive, personId, today = todayISO()) {
  const st = archive?.review?.[personId];
  if (!st || !archive?.people?.[personId]) return false;
  const due = str(st.due);
  return !due || due <= today;
}

/** true se la persona non è mai stata ripassata. */
export function isNewForReview(archive, personId) {
  return !archive?.review?.[personId];
}

/** Numero di persone da ripassare (badge della sidebar: le mai ripassate non contano). */
export function countReviewDue(archive, today = todayISO()) {
  let n = 0;
  for (const id of Object.keys(archive?.review || {})) if (reviewDue(archive, id, today)) n++;
  return n;
}

/**
 * Nuovo stato di ripasso dopo una risposta.
 *   "no"    → box 1, scadenza oggi (riproposta nella stessa sessione), lapses + 1
 *   "quasi" → stesso box (1 se nuova), scadenza domani
 *   "si"    → box + 1 (max 5; una persona nuova parte da 0 → box 1), scadenza oggi + intervallo del nuovo box
 */
export function nextReview(state, grade, today = todayISO()) {
  const prev = state && typeof state === 'object' ? state : null;
  const box = Math.min(5, Math.max(1, Number(prev?.box) || 1));
  const reviews = (Number(prev?.reviews) || 0) + 1;
  const lapses = Number(prev?.lapses) || 0;
  const last = new Date().toISOString();
  if (grade === 'no') return { box: 1, due: today, reviews, lapses: lapses + 1, last };
  if (grade === 'quasi') return { box, due: addDays(today, 1), reviews, lapses, last };
  const nextBox = prev ? Math.min(5, box + 1) : 1;
  return { box: nextBox, due: addDays(today, LEITNER_INTERVALS[nextBox]), reviews, lapses, last };
}

// ---------------------------------------------------------------------------
// Modelli vuoti
// ---------------------------------------------------------------------------

/** Nuova persona vuota (id generato). */
export function emptyPerson(extra = {}) {
  return { id: newId(), firstName: '', lastName: '', nickname: '', photos: [], tags: [], fields: {}, diary: [], documents: [], ...extra };
}

/** Nuovo gruppo vuoto (id generato). */
export function emptyGroup(extra = {}) {
  return { id: newId(), name: '', kind: '', description: '', tags: [], members: [], photos: [], documents: [], ...extra };
}

/** Nuovo evento vuoto (id generato). */
export function emptyEvent(extra = {}) {
  return { id: newId(), title: '', date: '', place: '', notes: '', tags: [], participants: [], photos: [], documents: [], ...extra };
}

/** Divide un testo libero in nome e cognome: "Mario De Rossi" → { firstName: "Mario", lastName: "De Rossi" }. */
export function splitName(text) {
  const words = str(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return { firstName: '', lastName: '' };
  return { firstName: words[0], lastName: words.slice(1).join(' ') };
}

/**
 * Distanza di Damerau-Levenshtein (con trasposizioni adiacenti) fra due stringhe, interrotta oltre `max`:
 * restituisce `max + 1` appena la distanza supera `max`. Usata dalla ricerca (errori di battitura) e dal
 * controllo dei possibili doppioni.
 */
export function editDistance(a, b, max = 2) {
  const x = str(a);
  const y = str(b);
  if (Math.abs(x.length - y.length) > max) return max + 1;
  const rows = [];
  for (let i = 0; i <= x.length; i++) {
    rows.push(new Array(y.length + 1).fill(0));
    rows[i][0] = i;
  }
  for (let j = 0; j <= y.length; j++) rows[0][j] = j;
  for (let i = 1; i <= x.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      let v = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) v = Math.min(v, rows[i - 2][j - 2] + 1);
      rows[i][j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
  }
  return rows[x.length][y.length];
}
