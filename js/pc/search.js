// Ricerca testuale senza IA: normalizzazione (minuscolo, senza accenti), match AND di tutti i token,
// punteggio pesato (il nome pesa di più), snippet del punto in cui si trova il match.
// Le parole "vuote" dell'italiano (articoli, preposizioni: "quella architetta DI firenze") non contano se nella
// ricerca c'è almeno una parola significativa; se non trova nessuno, la ricerca delle persone tollera un errore di
// battitura nelle parole di 5 o più lettere ("architeta" → "architetta").
// Documentazione: docs/frontend.md

import {
  displayName, fieldValueText, hasTag, compareText, personRefText, listGroups, listEvents, editDistance,
} from './domain.js';
import { formatDate } from './format.js';

const DIACRITICS = /[̀-ͯ]/g;
const APOSTROPHES = /['’‘`´]/g;
const NON_WORD = /[^\p{L}\p{N}]+/gu;

/** Testo normalizzato per la ricerca: minuscolo, senza accenti né apostrofi, punteggiatura → spazio, spazi collassati. */
export function normalizeText(s) {
  if (s == null) return '';
  return String(s)
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLocaleLowerCase('it')
    .replace(APOSTROPHES, '')
    .replace(NON_WORD, ' ')
    .trim();
}

/** Token della query (normalizzati, senza duplicati). */
export function tokenize(query) {
  return Array.from(new Set(normalizeText(query).split(' ').filter(Boolean)));
}

/**
 * Parole "vuote" della lingua parlata: articoli, preposizioni (anche articolate), congiunzioni e riempitivi con cui
 * una persona smemorata descrive qualcuno ("quella architetta di Firenze", "il notaio", "quello con la barba").
 * Sono già normalizzate (minuscolo, senza accenti: "è" → "e").
 */
export const STOPWORDS = new Set([
  'il', 'lo', 'la', 'i', 'gli', 'le', 'l', 'un', 'uno', 'una',
  'di', 'da', 'a', 'ad', 'in', 'con', 'col', 'per', 'su', 'tra', 'fra',
  'del', 'dello', 'della', 'dei', 'degli', 'delle', 'dal', 'dallo', 'dalla', 'dai', 'dagli', 'dalle',
  'al', 'allo', 'alla', 'ai', 'agli', 'alle', 'nel', 'nello', 'nella', 'nei', 'negli', 'nelle',
  'sul', 'sullo', 'sulla', 'sui', 'sugli', 'sulle',
  'e', 'ed', 'o', 'od', 'che', 'chi', 'mi', 'ti', 'si', 'ci', 'vi', 'ne', 'non',
  'era', 'erano', 'ha', 'hanno', 'aveva', 'avevano', 'ho', 'sono',
  'quello', 'quella', 'quelli', 'quelle', 'quel', 'quei', 'questo', 'questa', 'questi', 'queste',
  'tipo', 'tizio', 'tizia', 'signor', 'signore', 'signora',
]);

// Articoli e preposizioni elisi davanti all'apostrofo ("l'architetta", "dell'ordine", "d'impresa"): nella query
// si staccano dalla parola che segue, altrimenti "l'architetta" diventerebbe "larchitetta" e non troverebbe nessuno.
const ELISION = /(^|[^\p{L}\p{N}])(?:l|un|d|dell|dall|nell|sull|all|coll|quell|quest|nessun|c|s|m|t|v)['’‘`´](?=\p{L})/giu;

/**
 * Token di una RICERCA: come tokenize(), ma senza gli articoli elisi e senza le parole vuote (STOPWORDS), purché
 * resti almeno una parola significativa ("di" da solo cerca ancora "di"; "Di Pietro" cerca "pietro").
 */
export function searchTokens(query) {
  const all = tokenize(String(query ?? '').replace(ELISION, '$1 '));
  const meaningful = all.filter((t) => !STOPWORDS.has(t));
  return meaningful.length ? meaningful : tokenize(query);
}

/** true se TUTTI i token della query (senza parole vuote) compaiono (come sottostringa) nel testo o nei testi indicati. */
export function matchText(textOrParts, query) {
  const tokens = searchTokens(query);
  if (!tokens.length) return true;
  const hay = normalizeText(Array.isArray(textOrParts) ? textOrParts.filter(Boolean).join(' ') : textOrParts);
  return tokens.every((t) => hay.includes(t));
}

/**
 * Normalizza tenendo la mappa degli indici: norm[i] deriva da text[map[i]].
 * Usata per evidenziare e per gli snippet (più lenta di normalizeText: solo su pochi testi).
 */
function normalizeWithMap(text) {
  const src = String(text ?? '');
  let norm = '';
  const map = [];
  for (let i = 0; i < src.length;) {
    const cp = src.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    let n = ch.normalize('NFD').replace(DIACRITICS, '').toLocaleLowerCase('it').replace(APOSTROPHES, '');
    if (n && /[^\p{L}\p{N}]/u.test(n)) n = n.replace(NON_WORD, ' ');
    for (const c of n) {
      if (c === ' ' && (norm === '' || norm.endsWith(' '))) continue;
      norm += c;
      map.push(i);
    }
    i += ch.length;
  }
  if (norm.endsWith(' ')) { norm = norm.slice(0, -1); map.pop(); }
  map.push(src.length);
  return { norm, map };
}

/**
 * Intervalli [inizio, fine) nel testo ORIGINALE dove compaiono i token della query (uniti se sovrapposti).
 * Usato dal componente Highlight.
 */
export function highlightRanges(text, query) {
  const tokens = searchTokens(query);
  if (!tokens.length || !text) return [];
  const { norm, map } = normalizeWithMap(text);
  const ranges = [];
  for (const t of tokens) {
    let from = 0;
    for (;;) {
      const idx = norm.indexOf(t, from);
      if (idx < 0) break;
      const start = map[idx];
      const endNorm = idx + t.length;
      const end = endNorm < map.length - 1 ? map[endNorm] : String(text).length;
      ranges.push([start, Math.max(end, start + 1)]);
      from = idx + t.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** Estratto di `text` attorno al primo match della query ("…testo attorno…"), max ~`width` caratteri. */
export function excerpt(text, query, width = 90) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const ranges = highlightRanges(clean, query);
  if (clean.length <= width) return clean;
  const at = ranges.length ? ranges[0][0] : 0;
  let start = Math.max(0, at - Math.floor(width * 0.35));
  let end = Math.min(clean.length, start + width);
  if (end - start < width) start = Math.max(0, end - width);
  // non spezzare le parole ai bordi
  if (start > 0) { const sp = clean.indexOf(' ', start); if (sp > 0 && sp < at) start = sp + 1; }
  if (end < clean.length) { const sp = clean.lastIndexOf(' ', end); if (sp > at) end = sp; }
  return `${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`;
}

// ---------------------------------------------------------------------------
// Indice delle persone
//
// Una voce per persona, in una WeakMap con chiave l'OGGETTO persona: lo store tratta l'archivio come immutabile e
// sostituisce solo gli oggetti modificati, quindi cambiare le impostazioni o una persona non fa reindicizzare le
// altre. Oltre alla persona, la voce dipende da oggetti esterni (schema, gruppi ed eventi di cui fa parte, persone
// citate nei suoi campi, documenti): vengono confrontati per identità e, se uno cambia, la voce si ricostruisce.
// ---------------------------------------------------------------------------

// Pesi delle fonti. `context` = note e tag di eventi e gruppi di cui la persona fa parte: sotto ai suoi dati.
const W = { name: 10, nick: 9, tag: 6, role: 4, field: 3, group: 3, event: 2, note: 2.5, diary: 2, context: 1.5, doc: 1 };

const EMPTY = Object.freeze([]);
const docCache = new WeakMap(); // Person → { schema, deps, sources, hay }
const groupsIndexCache = new WeakMap(); // archive.groups → Map(personId → [{ group, role }])
const eventsIndexCache = new WeakMap(); // archive.events → Map(personId → [{ event, note }])
const NO_ENTITIES = Object.freeze({});
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

function pushTo(map, key, value) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** personId → [{ group, role }] nello stesso ordine di groupsOfPerson (per nome del gruppo). Un passaggio solo. */
function groupsIndex(archive) {
  const groups = archive.groups || NO_ENTITIES;
  let idx = groupsIndexCache.get(groups);
  if (!idx) {
    idx = new Map();
    for (const group of listGroups(archive)) {
      const seen = new Set();
      for (const m of group.members || []) {
        if (!m || !m.personId || seen.has(m.personId)) continue;
        seen.add(m.personId);
        pushTo(idx, m.personId, { group, role: str(m.role) });
      }
    }
    groupsIndexCache.set(groups, idx);
  }
  return idx;
}

/** personId → [{ event, note }] nello stesso ordine di eventsOfPerson (per data decrescente). Un passaggio solo. */
function eventsIndex(archive) {
  const events = archive.events || NO_ENTITIES;
  let idx = eventsIndexCache.get(events);
  if (!idx) {
    idx = new Map();
    for (const event of listEvents(archive)) {
      const seen = new Set();
      for (const p of event.participants || []) {
        if (!p || !p.personId || seen.has(p.personId)) continue;
        seen.add(p.personId);
        pushTo(idx, p.personId, { event, note: str(p.note) });
      }
    }
    eventsIndexCache.set(events, idx);
  }
  return idx;
}

/** Oggetti esterni da cui dipende la voce di una persona (confrontati per identità). */
function personDeps(archive, person, groups, events) {
  const deps = [];
  for (const g of groups) deps.push(g.group);
  for (const e of events) deps.push(e.event);
  for (const v of Object.values(person.fields || {})) {
    for (const r of Array.isArray(v) ? v : [v]) {
      if (r && typeof r === 'object' && r.personId) deps.push(archive.people?.[r.personId]);
    }
  }
  for (const fid of person.documents || []) deps.push(archive.files?.[fid]);
  return deps;
}

function sameDeps(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function buildPersonDoc(archive, person, groups, events) {
  const sources = [];
  const add = (kind, label, text, weight) => {
    const t = typeof text === 'string' ? text : text == null ? '' : String(text);
    if (!t.trim()) return;
    sources.push({ kind, label, text: t, norm: normalizeText(t), weight });
  };
  add('name', 'Nome', person.firstName, W.name);
  add('name', 'Cognome', person.lastName, W.name);
  add('name', 'Soprannome', person.nickname, W.nick);
  for (const t of person.tags || []) add('tag', 'Tag', t, W.tag);
  for (const field of archive.schema?.fields || []) {
    const v = person.fields?.[field.id];
    if (v === undefined) continue;
    const text = fieldValueText(archive, field, v);
    add('field', field.label || field.id, text, field.role === 'job' || field.role === 'city' ? W.role : W.field);
  }
  for (const d of person.diary || []) add('diary', d.date ? `Diario, ${formatDate(d.date)}` : 'Diario', d.text, W.diary);
  for (const { group, role } of groups) {
    add('group', 'Gruppo', group.name, W.group);
    if (role) add('group', `Ruolo in ${group.name || 'gruppo'}`, role, W.group);
    // Descrizione e tag del gruppo: pesano meno dei dati della persona ("quelli dello studio che segue i fallimenti").
    add('group', `Descrizione di «${group.name || 'gruppo'}»`, group.description, W.context);
    for (const t of group.tags || []) add('group', `Tag di «${group.name || 'gruppo'}»`, t, W.context);
  }
  for (const { event, note } of events) {
    add('event', 'Evento', [event.title, event.place].filter(Boolean).join(' — '), W.event);
    if (note) add('note', `Nota da «${event.title || 'evento'}»`, note, W.note);
    // Note e tag dell'evento: "quelli del convegno sulla crisi d'impresa" trova i partecipanti.
    add('event', `Note di «${event.title || 'evento'}»`, event.notes, W.context);
    for (const t of event.tags || []) add('event', `Tag di «${event.title || 'evento'}»`, t, W.context);
  }
  for (const fid of person.documents || []) {
    const f = archive.files?.[fid];
    if (f?.name) add('doc', 'Documento', f.name, W.doc);
  }
  const hay = sources.map((s) => s.norm).join(' \u0001 ');
  return { sources, hay, words: null };
}

/** Parole distinte (normalizzate) della voce di una persona: calcolate solo se servono (ricerca tollerante). */
function docWords(doc) {
  if (!doc.words) doc.words = Array.from(new Set(doc.hay.split(/[\s\u0001]+/).filter(Boolean)));
  return doc.words;
}

const FUZZY_MIN = 5; // lettere minime perché una parola della ricerca tolleri un errore di battitura

/**
 * Parola di `words` "quasi uguale" al token: distanza di Damerau-Levenshtein 1 dalla parola intera o dal suo inizio
 * ("architeta" → "architetta", "archiet" → "architetto"). null se non c'è o se il token è corto.
 */
function fuzzyWord(words, token) {
  if (token.length < FUZZY_MIN) return null;
  for (const w of words) {
    if (Math.abs(w.length - token.length) <= 1 && editDistance(token, w, 1) <= 1) return w;
  }
  for (const w of words) {
    if (w.length <= token.length) continue;
    for (const n of [token.length - 1, token.length, token.length + 1]) {
      if (n >= FUZZY_MIN - 1 && n <= w.length && editDistance(token, w.slice(0, n), 1) <= 1) return w;
    }
  }
  return null;
}

function personDoc(archive, person) {
  const groups = groupsIndex(archive).get(person.id) || EMPTY;
  const events = eventsIndex(archive).get(person.id) || EMPTY;
  const deps = personDeps(archive, person, groups, events);
  const schema = archive.schema || null;
  let doc = docCache.get(person);
  if (!doc || doc.schema !== schema || !sameDeps(doc.deps, deps)) {
    doc = { schema, deps, ...buildPersonDoc(archive, person, groups, events) };
    docCache.set(person, doc);
  }
  return doc;
}

function tokenScore(source, token) {
  const idx = source.norm.indexOf(token);
  if (idx < 0) return 0;
  const wordStart = idx === 0 || source.norm[idx - 1] === ' ';
  const end = idx + token.length;
  const wordEnd = end === source.norm.length || source.norm[end] === ' ';
  let s = source.weight;
  if (wordStart) s *= 1.5;
  if (wordStart && wordEnd) s *= 1.25;
  return s;
}

function passesFilters(archive, person, filters) {
  if (!filters) return true;
  const tags = Array.isArray(filters.tags) ? filters.tags.filter(Boolean) : [];
  for (const t of tags) if (!hasTag(person.tags, t)) return false;
  if (filters.groupId) {
    const g = archive.groups?.[filters.groupId];
    if (!g || !(g.members || []).some((m) => m && m.personId === person.id)) return false;
  }
  if (filters.hasPhoto === true && !(person.photos || []).length) return false;
  if (filters.hasPhoto === false && (person.photos || []).length) return false;
  return true;
}

/** Punteggio e snippet di una persona per i termini trovati (token della ricerca o parole quasi uguali). */
function scorePerson(person, doc, terms) {
  let score = 0;
  let best = null;
  for (const t of terms) {
    let top = 0;
    for (const src of doc.sources) {
      const s = tokenScore(src, t);
      if (s > top) top = s;
      if (s > 0 && src.kind !== 'name' && (!best || src.weight > best.weight)) best = src;
    }
    score += top;
  }
  const phrase = terms.join(' ');
  const nameNorm = normalizeText(displayName(person) + ' ' + (person.nickname || ''));
  if (nameNorm.includes(phrase)) score += terms.length > 1 ? 12 : 4;
  if (nameNorm.startsWith(phrase)) score += 3;

  const nameMatchesAll = terms.every((t) => doc.sources.some((s) => s.kind === 'name' && s.norm.includes(t)));
  let match = null;
  if (best && !nameMatchesAll) match = { label: best.label, text: best.kind === 'tag' ? best.text : excerpt(best.text, phrase) };
  return { person, score, match, snippet: match ? `${match.label}: ${match.text}` : '' };
}

const byScore = (a, b) => b.score - a.score || compareText(displayName(a.person), displayName(b.person));

/**
 * Cerca tra le persone. Tutti i token della query (senza le parole vuote: vedi searchTokens) devono comparire (AND)
 * in nome, soprannome, tag, valori dei campi, diario, gruppi (nome, ruolo, descrizione, tag), eventi (titolo, luogo,
 * note, tag) e note di partecipazione, nomi dei documenti.
 * Se nessuno corrisponde, riprova tollerando un errore di battitura nelle parole di almeno 5 lettere: i risultati
 * hanno `approximate: true` (e anche l'array ha `approximate = true`). Con `filters.partial`, se ancora nessuno
 * corrisponde, restituisce chi ha ALMENO UNA delle parole (prima chi ne ha di più): risultati e array con
 * `partial: true`, da presentare con un titolo tipo «Nessuno con tutte le parole: ecco i più vicini».
 * @param {object} archive
 * @param {string} query
 * @param {{tags?: string[], groupId?: string, hasPhoto?: boolean, partial?: boolean}} [filters]
 * @returns {{person, score:number, snippet:string, match: {label:string, text:string}|null, approximate?: boolean,
 *   partial?: boolean}[]}
 *   ordinati per punteggio decrescente (poi per nome). Query vuota → tutte le persone filtrate, per nome, score 0.
 *   `snippet` = "Etichetta: …testo…" del primo match fuori dal nome ("" se il match è solo sul nome).
 */
export function searchPeople(archive, query, filters = {}) {
  if (!archive?.people) return [];
  const tokens = searchTokens(query);
  const people = Object.values(archive.people).filter((p) => p && passesFilters(archive, p, filters));

  if (!tokens.length) {
    return people
      .map((person) => ({ person, score: 0, snippet: '', match: null }))
      .sort((a, b) => compareText(displayName(a.person), displayName(b.person)));
  }

  const results = [];
  for (const person of people) {
    const doc = personDoc(archive, person);
    if (tokens.every((t) => doc.hay.includes(t))) results.push(scorePerson(person, doc, tokens));
  }
  if (results.length) return results.sort(byScore);

  // Nessuno con tutte le parole esatte: errori di battitura ("architeta") e, se richiesto, corrispondenze parziali.
  const approx = [];
  const partial = [];
  for (const person of people) {
    const doc = personDoc(archive, person);
    const found = [];
    for (const t of tokens) {
      const w = doc.hay.includes(t) ? t : fuzzyWord(docWords(doc), t);
      if (w) found.push(w);
    }
    if (found.length === tokens.length) approx.push({ ...scorePerson(person, doc, found), approximate: true });
    else if (filters.partial && found.length && tokens.length > 1) {
      partial.push({ ...scorePerson(person, doc, found), approximate: true, partial: true, matched: found.length });
    }
  }
  if (approx.length) {
    const out = approx.sort(byScore);
    out.approximate = true;
    return out;
  }
  if (partial.length) {
    const out = partial.sort((a, b) => b.matched - a.matched || byScore(a, b));
    out.approximate = true;
    out.partial = true;
    return out;
  }
  return [];
}

/**
 * Cerca tra i gruppi (nome, tipo, descrizione, tag, nomi e ruoli dei membri). Query vuota → tutti, per nome.
 * @returns {{group, score:number}[]}
 */
export function searchGroups(archive, query) {
  const tokens = searchTokens(query);
  const groups = Object.values(archive?.groups || {}).filter(Boolean);
  const out = [];
  for (const group of groups) {
    if (!tokens.length) { out.push({ group, score: 0 }); continue; }
    const main = normalizeText([group.name, group.kind].join(' '));
    const rest = normalizeText([
      group.description, ...(group.tags || []),
      ...(group.members || []).map((m) => `${personRefText(archive, { personId: m.personId })} ${m.role || ''}`),
    ].join(' '));
    if (!tokens.every((t) => main.includes(t) || rest.includes(t))) continue;
    out.push({ group, score: tokens.reduce((s, t) => s + (main.includes(t) ? 3 : 1), 0) });
  }
  return out.sort((a, b) => b.score - a.score || compareText(a.group.name, b.group.name));
}

/**
 * Cerca tra gli eventi (titolo, luogo, data, note, tag, partecipanti e loro note). Query vuota → tutti.
 * @returns {{event, score:number}[]} per punteggio, poi data decrescente.
 */
export function searchEvents(archive, query) {
  const tokens = searchTokens(query);
  const events = Object.values(archive?.events || {}).filter(Boolean);
  const out = [];
  for (const event of events) {
    if (!tokens.length) { out.push({ event, score: 0 }); continue; }
    const main = normalizeText([event.title, event.place, formatDate(event.date, { style: 'long' })].join(' '));
    const rest = normalizeText([
      event.notes, ...(event.tags || []),
      ...(event.participants || []).map((p) => `${personRefText(archive, { personId: p.personId })} ${p.note || ''}`),
    ].join(' '));
    if (!tokens.every((t) => main.includes(t) || rest.includes(t))) continue;
    out.push({ event, score: tokens.reduce((s, t) => s + (main.includes(t) ? 3 : 1), 0) });
  }
  const d = (e) => e.date || '';
  return out.sort((a, b) => b.score - a.score || (d(a.event) < d(b.event) ? 1 : d(a.event) > d(b.event) ? -1 : 0));
}
