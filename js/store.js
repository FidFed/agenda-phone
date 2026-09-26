// Stato della web app del telefono.
//   status: "caricamento" | "benvenuto" (nessun pacchetto) | "bloccato" | "aperto" | "errore"
//   pkg:     { createdAt, appVersion, size, savedAt } del pacchetto salvato (dall'header in chiaro: niente dati personali)
//   archive: archivio decifrato (solo da aperto), con i progressi del ripasso del telefono uniti a quelli del PC
//   notice:  { kind, text } messaggio per la schermata di sblocco (perché si è bloccata, pacchetto aggiornato…)
// Al blocco: via le chiavi, l'archivio, gli URL delle foto, i codici dei tag e le cache delle schermate (onLock).
import { useEffect, useState } from './html.js';
import { AAD, openJson, parseHeader, sealJson, unlock } from './pacchetto.js';
import { dbDestroy, dbGet, dbPut } from './db.js';
import { clearPhotos, setPhotoSource } from './photos.js';
import { startAutoLock, stopAutoLock } from './autolock.js';
import { clearTagRoutes, prepareTagRoutes, setTagRoutes } from './tagroute.js';
import { formatDateTime } from './pc/format.js';

const THEME_KEY = 'agenda-telefono:tema';
const THEMES = new Set(['dark', 'light', 'system']);

let state = { status: 'caricamento', pkg: null, archive: null, notice: null, info: null, error: null };
const listeners = new Set();
const lockHandlers = new Set();

let session = null; // risultato di unlock(): chiavi e lettura delle foto
let phoneReview = {}; // progressi del ripasso fatti sul telefono (personId → ReviewState)
let saveTimer = null;
let savePending = null;
let olderAlreadyShown = false; // l'avviso "pacchetto più vecchio" dell'intestazione è già stato mostrato

function set(patch) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn(state);
}

export const getState = () => state;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Hook: una parte dello stato (ri-renderizza quando cambia). */
export function useStore(select = (s) => s) {
  const [value, setValue] = useState(() => select(state));
  useEffect(() => {
    const off = subscribe((s) => setValue(() => select(s)));
    setValue(() => select(state)); // cambi arrivati tra il primo render e l'iscrizione
    return off;
  }, []);
  return value;
}

/** Registra una funzione chiamata a ogni blocco (per svuotare cache con dati personali). */
export function onLock(fn) {
  lockHandlers.add(fn);
  return () => lockHandlers.delete(fn);
}

// ---------------------------------------------------------------------------
// Tema: scuro di default, poi quello del PC (letto dal pacchetto e ricordato per la schermata di sblocco)
// ---------------------------------------------------------------------------

function storedTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return THEMES.has(t) ? t : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme) {
  const t = THEMES.has(theme) ? theme : 'dark';
  document.documentElement.dataset.theme = t;
  const light = t === 'light' || (t === 'system' && window.matchMedia?.('(prefers-color-scheme: light)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f6f7f9' : '#0f1115');
  try { localStorage.setItem(THEME_KEY, t); } catch { /* ignora */ }
}

// ---------------------------------------------------------------------------
// Avvio, pacchetto, sblocco, blocco
// ---------------------------------------------------------------------------

const pkgMeta = (rec) => ({ createdAt: rec.createdAt || '', appVersion: rec.appVersion || '', size: rec.size || rec.blob?.size || 0, savedAt: rec.savedAt || '' });

export async function init() {
  applyTheme(storedTheme());
  try {
    const rec = await dbGet('pacchetto');
    set(rec?.blob ? { status: 'bloccato', pkg: pkgMeta(rec) } : { status: 'benvenuto', pkg: null });
  } catch {
    set({
      status: 'errore',
      error: 'Questo browser non mi lascia salvare dati sul telefono (forse sei in una finestra di navigazione in incognito). '
        + 'Apri la web app in una finestra normale o installala dalla schermata Home.',
    });
  }
}

/**
 * Salva sul telefono un pacchetto scelto con il selettore di file (ancora cifrato) e torna alla password.
 * Controlla prima l'header: un file sbagliato non sostituisce quello buono. Errori: messaggio italiano.
 * @returns {Promise<{older: boolean}>}
 */
export async function choosePackage(file) {
  const info = await parseHeader(file);
  const prev = state.pkg;
  const rec = { blob: file, createdAt: info.createdAt, appVersion: info.appVersion, size: info.size, savedAt: new Date().toISOString() };
  try {
    await dbPut('pacchetto', rec);
  } catch (err) {
    const e = new Error('Non sono riuscito a salvare il pacchetto sul telefono: forse lo spazio è pieno. Libera un po\' di spazio e riprova.');
    e.cause = err;
    throw e;
  }
  try { await navigator.storage?.persist?.(); } catch { /* facoltativo */ }
  // Data dell'intestazione, non autenticata: basta per un avviso subito; il controllo vero (sulla data cifrata
  // nell'indice) lo fa unlockWith dopo la password.
  const older = !!(prev?.createdAt && info.createdAt && info.createdAt < prev.createdAt);
  const when = info.createdAt ? formatDateTime(info.createdAt) : '';
  const wasOpen = state.status === 'aperto';
  await lock(null);
  olderAlreadyShown = older;
  set({
    status: 'bloccato',
    pkg: pkgMeta(rec),
    notice: prev
      ? {
        kind: older ? 'warning' : 'success',
        text: `${older ? 'Attenzione: questo pacchetto è più vecchio di quello che avevi. ' : 'Pacchetto aggiornato. '}`
          + `${when ? `Dati del ${when}. ` : ''}${wasOpen ? 'Inserisci la password per riaprire Agenda.' : 'Inserisci la password.'}`,
      }
      : { kind: 'success', text: `Pacchetto salvato sul telefono${when ? ` (dati del ${when})` : ''}. Ora inserisci la password di Agenda.` },
  });
  return { older };
}

function mergeReview(pc, phone) {
  const out = { ...(pc || {}) };
  for (const [id, st] of Object.entries(phone || {})) {
    const base = out[id];
    // Vince lo stato più recente: il ripasso fatto sul telefono dopo l'ultimo sul PC, o il contrario.
    if (!base || String(st?.last || '') > String(base.last || '')) out[id] = st;
  }
  return out;
}

async function loadPhoneReview(key) {
  try {
    const rec = await dbGet('ripasso');
    if (!rec) return {};
    const data = await openJson(key, rec, AAD.ripasso);
    return data && typeof data.states === 'object' && data.states ? data.states : {};
  } catch {
    return {}; // progressi di un'altra agenda (altra chiave) o illeggibili: si riparte da quelli del PC
  }
}

/**
 * Pacchetto più vecchio di quello aperto l'ultima volta su questo telefono? Confronta la data dell'esportazione
 * cifrata nell'indice (autenticata, a differenza di quella dell'intestazione) con quella ricordata, cifrata, in
 * IndexedDB; poi ricorda quella di adesso. Restituisce la data precedente se questo pacchetto è più vecchio.
 */
async function checkRollback(s) {
  let prev = null;
  try {
    const rec = await dbGet('visto');
    if (rec) prev = await openJson(s.kRipasso, rec, AAD.visto);
  } catch {
    prev = null; // di un'altra agenda o illeggibile: nessun confronto
  }
  try {
    await dbPut('visto', await sealJson(s.kRipasso, { exportedAt: s.exportedAt, revision: s.revision }, AAD.visto));
  } catch { /* facoltativo */ }
  const older = typeof prev?.exportedAt === 'string' && typeof s.exportedAt === 'string' && s.exportedAt < prev.exportedAt;
  return older ? prev.exportedAt : null;
}

/**
 * Sblocca con la password. Errori: PacchettoError (messaggio italiano).
 * @returns {Promise<{olderThan: string|null}>} `olderThan` = data del pacchetto aperto l'ultima volta, se questo è
 *   più vecchio (e l'avviso non è già stato mostrato scegliendo il file)
 */
export async function unlockWith(password) {
  const rec = await dbGet('pacchetto');
  if (!rec?.blob) {
    set({ status: 'benvenuto', pkg: null });
    return { olderThan: null };
  }
  const s = await unlock(rec.blob, password);
  const phone = await loadPhoneReview(s.kRipasso);
  const routes = await prepareTagRoutes(s.kRotte, s.archive);
  const olderThan = await checkRollback(s);
  // Se l'avviso sull'intestazione c'è già stato e l'intestazione dice il vero, non lo ripeto.
  const shown = olderAlreadyShown && s.createdAt === s.exportedAt;
  olderAlreadyShown = false;
  session = s;
  setTagRoutes(routes);
  phoneReview = phone;
  setPhotoSource(s);
  const archive = { ...s.archive, review: mergeReview(s.archive.review, phone) };
  applyTheme(archive.settings?.theme);
  set({
    status: 'aperto',
    archive,
    notice: null,
    info: {
      exportedAt: s.exportedAt,
      createdAt: s.createdAt,
      appVersion: s.appVersion,
      size: s.size,
      revision: s.revision,
      photos: Object.values(s.files).filter((f) => f && f.kind === 'photo').length,
      thumbs: Object.values(s.files).filter((f) => f && f.kind === 'thumb').length,
    },
  });
  startAutoLock((reason) => { lock(reason); });
  return { olderThan: shown ? null : olderThan };
}

const LOCK_NOTICES = {
  inattivita: 'Agenda si è bloccata dopo 5 minuti senza usarla.',
  background: 'Agenda si è bloccata perché è rimasta in secondo piano per più di un minuto.',
};

/** Blocca: dimentica chiavi, archivio decifrato, foto e cache delle schermate. */
export async function lock(reason = 'manuale') {
  stopAutoLock();
  const flush = flushReview();
  session = null;
  phoneReview = {};
  clearPhotos();
  clearTagRoutes();
  for (const fn of lockHandlers) {
    try { fn(); } catch { /* ignora */ }
  }
  if (state.status === 'aperto') {
    set({ status: 'bloccato', archive: null, info: null, notice: LOCK_NOTICES[reason] ? { kind: 'info', text: LOCK_NOTICES[reason] } : null });
  }
  await flush;
}

/** Cancella dal telefono pacchetto e progressi del ripasso. */
export async function forget() {
  await lock(null);
  clearTimeout(saveTimer);
  savePending = null;
  await dbDestroy();
  try { localStorage.clear(); } catch { /* ignora */ }
  applyTheme('dark');
  set({ status: 'benvenuto', pkg: null, archive: null, info: null, notice: { kind: 'success', text: 'Pacchetto e progressi del ripasso cancellati da questo telefono.' } });
}

// ---------------------------------------------------------------------------
// Ripasso: i progressi restano sul telefono, cifrati (HKDF(MK, "agenda-telefono-ripasso-v1"))
// ---------------------------------------------------------------------------

/** Registra un nuovo stato di ripasso per la persona e lo salva (cifrato) poco dopo. */
export function saveReview(personId, next) {
  if (!session || state.status !== 'aperto') return;
  phoneReview = { ...phoneReview, [personId]: next };
  set({ archive: { ...state.archive, review: { ...state.archive.review, [personId]: next } } });
  const key = session.kRipasso;
  const states = phoneReview;
  savePending = async () => {
    const sealed = await sealJson(key, { states, savedAt: new Date().toISOString() }, AAD.ripasso);
    await dbPut('ripasso', sealed);
  };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { flushReview(); }, 250);
}

function flushReview() {
  clearTimeout(saveTimer);
  const job = savePending;
  savePending = null;
  return job ? job().catch(() => { /* il prossimo salvataggio riproverà */ }) : Promise.resolve();
}

/** Quante persone hanno progressi fatti sul telefono. */
export const phoneReviewCount = () => Object.keys(phoneReview).length;
