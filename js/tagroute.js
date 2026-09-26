// Tag nell'indirizzo della pagina: mai il nome. L'indirizzo finisce nella cronologia di Chrome, che resta dopo il
// blocco e può essere sincronizzata con l'account Google; al suo posto c'è un codice che da solo non vuol dire
// niente (pacchetto.routeToken: HMAC con una chiave ricavata dalla MK, quindi senza la password non si risale al
// nome). Stesso tag → stesso codice anche dopo un blocco o con un pacchetto più nuovo della stessa agenda.
// Le tabelle stanno solo in memoria: preparate allo sblocco, svuotate al blocco.
import { normalizeTag, tagKey } from './pc/domain.js';
import { routeToken } from './pacchetto.js';

let byKey = new Map(); // tagKey(nome) → codice
let byToken = new Map(); // codice → nome del tag

/** Tutti i tag dell'archivio (persone, gruppi, eventi, colori) → tabelle { byKey, byToken }. */
export async function prepareTagRoutes(key, archive) {
  const names = new Map();
  const add = (t) => {
    const name = normalizeTag(t);
    const k = tagKey(name);
    if (k && !names.has(k)) names.set(k, name);
  };
  for (const map of [archive?.people, archive?.groups, archive?.events]) {
    for (const e of Object.values(map || {})) for (const t of e?.tags || []) add(t);
  }
  for (const t of Object.keys(archive?.tagMeta || {})) add(t);
  const tables = { byKey: new Map(), byToken: new Map() };
  for (const [k, name] of names) {
    const token = await routeToken(key, k);
    tables.byKey.set(k, token);
    tables.byToken.set(token, name);
  }
  return tables;
}

export function setTagRoutes(tables) {
  byKey = tables?.byKey || new Map();
  byToken = tables?.byToken || new Map();
}

export function clearTagRoutes() {
  byKey = new Map();
  byToken = new Map();
}

/** Codice del tag per l'indirizzo ("" se sconosciuto). */
export const tagToken = (name) => byKey.get(tagKey(name)) || '';

/** Nome del tag dal codice dell'indirizzo ("" se sconosciuto, per esempio dopo il blocco). */
export const tagFromToken = (token) => byToken.get(String(token || '')) || '';
