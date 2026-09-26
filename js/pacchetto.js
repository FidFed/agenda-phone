// Lettore del pacchetto per il telefono (agenda-telefono.agdp, SPEC §11.1).
//
// Stesso modulo nel browser (web app del telefono) e in Node (test): usa solo WebCrypto
// (globalThis.crypto.subtle), DecompressionStream per il gzip e argon2id in WebAssembly (hash-wasm).
//
//   parseHeader(bytes | Blob)          → { header, bodyOffset, size, createdAt, appVersion }   (niente password)
//   unlock(bytes | Blob, password)     → sessione { archive, files, exportedAt, revision, kTel, kRipasso, kRotte,
//                                         hasFile(id), getFile(id) → Blob, ... }
//   sealJson(key, obj, aad) / openJson(key, sealed, aad)   piccoli record cifrati (progressi del ripasso)
//   routeToken(kRotte, testo)          → codice opaco per l'indirizzo (i tag non finiscono mai nella cronologia)
//
// Formato:
//   MAGIC "AGDP"(4) | versione 0x01 (1) | lunghezza header uint32 big-endian (4) | header JSON UTF-8 | corpo
//   corpo = record AES-256-GCM: nonce(12) | ciphertext | tag(16)
//   MK   = chiave principale, avvolta nell'header con la chiave della password (argon2id, AAD "agenda-mk-v1")
//   K_tel = HKDF-SHA256(MK, salt vuoto, info "agenda-telefono-v1")  → indice (AAD "telefono:indice", gzip JSON)
//                                                                     e file (AAD "telefono:file:<id>")
// Tutti gli errori sono PacchettoError con un codice e un messaggio in italiano da mostrare così com'è.

const MAGIC = [0x41, 0x47, 0x44, 0x50]; // "AGDP"
const FORMAT_VERSION = 1;
const PREFIX = 9; // magic + versione + lunghezza header
const MAX_HEADER = 1024 * 1024;
const NONCE = 12;
const TAG = 16;

export const AAD = Object.freeze({
  mk: 'agenda-mk-v1',
  indice: 'telefono:indice',
  file: (id) => `telefono:file:${id}`,
  ripasso: 'telefono:ripasso',
  visto: 'telefono:visto',
});
export const INFO = Object.freeze({
  telefono: 'agenda-telefono-v1',
  ripasso: 'agenda-telefono-ripasso-v1',
  rotte: 'agenda-telefono-rotte-v1',
});

export const MESSAGGI = Object.freeze({
  password_errata: 'Password errata. È la stessa che usi per aprire Agenda sul PC.',
  file_non_valido: 'Questo file non è un pacchetto di Agenda per il telefono. Scegli agenda-telefono.agdp.',
  file_danneggiato: 'Il pacchetto è danneggiato o incompleto (forse non è stato scaricato del tutto). '
    + 'Aspetta che Google Drive finisca di sincronizzarlo e sceglilo di nuovo.',
  versione_futura: 'Questo pacchetto viene da una versione più recente di Agenda: aggiorna la pagina della web app e riprova.',
  file_mancante: 'Questa foto non è nel pacchetto del telefono.',
  argon2_non_disponibile: 'Non riesco a preparare lo sblocco su questo dispositivo: il browser è troppo vecchio.',
  memoria: 'Il telefono non ha abbastanza memoria libera per aprire il pacchetto. Chiudi qualche app e riprova.',
});

export class PacchettoError extends Error {
  constructor(code, cause) {
    super(MESSAGGI[code] || MESSAGGI.file_non_valido);
    this.name = 'PacchettoError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

const fail = (code, cause) => { throw new PacchettoError(code, cause); };

// ---------------------------------------------------------------------------
// Utilità
// ---------------------------------------------------------------------------

function subtle() {
  const s = globalThis.crypto?.subtle;
  if (!s) fail('argon2_non_disponibile');
  return s;
}

const enc = new TextEncoder();
const utf8 = (s) => enc.encode(String(s));

/** Base64 → Uint8Array (atob esiste sia nei browser sia in Node). */
export function fromBase64(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) return null;
  let bin;
  try { bin = atob(s); } catch { return null; }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toBase64(bytes) {
  let bin = '';
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Blob da bytes (Uint8Array, ArrayBuffer, Buffer) o Blob/File così com'è. */
function toBlob(input) {
  if (input && typeof input.slice === 'function' && typeof input.arrayBuffer === 'function' && typeof input.size === 'number') {
    return input; // Blob o File
  }
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) return new Blob([input]);
  fail('file_non_valido');
}

async function readBytes(blob, start, end) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

const isInt = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;

async function gunzip(bytes) {
  if (typeof DecompressionStream !== 'function') fail('argon2_non_disponibile');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------------------------------------------------------------------------
// argon2id (hash-wasm, MIT): nel browser da vendor/argon2.umd.min.js, in Node dal pacchetto npm.
// ---------------------------------------------------------------------------

let argon2Impl = null;
let argon2Loading = null;

/** Imposta un'implementazione di argon2id compatibile con hash-wasm (per i test). */
export function setArgon2(fn) {
  argon2Impl = fn || null;
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('script non caricato'));
    document.head.appendChild(s);
  });
}

/** Carica argon2id (una volta sola). Nel browser si può chiamare in anticipo per non aspettare allo sblocco. */
export function loadArgon2() {
  if (argon2Impl) return Promise.resolve(argon2Impl);
  if (globalThis.hashwasm?.argon2id) return Promise.resolve(globalThis.hashwasm.argon2id);
  if (!argon2Loading) {
    argon2Loading = (async () => {
      if (typeof document !== 'undefined') {
        await loadScript(new URL('../vendor/argon2.umd.min.js', import.meta.url).href);
        if (globalThis.hashwasm?.argon2id) return globalThis.hashwasm.argon2id;
      } else if (typeof process !== 'undefined' && process.versions?.node) {
        const { createRequire } = await import('node:module');
        return createRequire(import.meta.url)('hash-wasm/dist/argon2.umd.min.js').argon2id;
      }
      throw new Error('argon2 non disponibile');
    })().catch((err) => {
      argon2Loading = null;
      throw new PacchettoError('argon2_non_disponibile', err);
    });
  }
  return argon2Loading;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function validHeader(h) {
  if (!h || typeof h !== 'object' || h.format !== 'agenda-telefono') return false;
  const { kdf, password: pw, index } = h;
  if (!kdf || kdf.alg !== 'argon2id') return false;
  // Limiti larghi ma finiti: un header alterato non deve poter chiedere al telefono gigabyte di memoria.
  if (!isInt(kdf.memory, 8, 1024 * 1024) || !isInt(kdf.passes, 1, 64) || !isInt(kdf.parallelism, 1, 64)) return false;
  if (fromBase64(kdf.salt)?.length !== 16) return false;
  if (!pw || fromBase64(pw.nonce)?.length !== NONCE || fromBase64(pw.ct)?.length !== 32 || fromBase64(pw.tag)?.length !== TAG) return false;
  if (!index || !isInt(index.offset, 0, Number.MAX_SAFE_INTEGER) || !isInt(index.length, NONCE + TAG, Number.MAX_SAFE_INTEGER)) return false;
  return true;
}

/**
 * Legge e controlla l'header (in chiaro: niente dati personali). Non serve la password.
 * @param {Blob|Uint8Array|ArrayBuffer} input
 * @returns {Promise<{header: object, bodyOffset: number, size: number, createdAt: string, appVersion: string}>}
 */
export async function parseHeader(input) {
  const blob = toBlob(input);
  if (blob.size < PREFIX) fail(blob.size >= 4 && (await startsWithMagic(blob)) ? 'file_danneggiato' : 'file_non_valido');
  const head = await readBytes(blob, 0, PREFIX);
  if (!MAGIC.every((b, i) => head[i] === b)) fail('file_non_valido');
  if (head[4] !== FORMAT_VERSION) fail(head[4] > FORMAT_VERSION ? 'versione_futura' : 'file_non_valido');
  const len = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(5, false);
  if (len < 2 || len > MAX_HEADER) fail('file_non_valido');
  if (PREFIX + len > blob.size) fail('file_danneggiato');
  let header;
  try {
    header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(blob, PREFIX, PREFIX + len)));
  } catch (err) {
    fail('file_non_valido', err);
  }
  if (header && header.format === 'agenda-telefono' && Number.isInteger(header.version) && header.version > FORMAT_VERSION) {
    fail('versione_futura');
  }
  if (header?.version !== FORMAT_VERSION || !validHeader(header)) fail('file_non_valido');
  const bodyOffset = PREFIX + len;
  if (header.index.offset + header.index.length > blob.size - bodyOffset) fail('file_danneggiato');
  return {
    header,
    bodyOffset,
    size: blob.size,
    createdAt: typeof header.createdAt === 'string' ? header.createdAt : '',
    appVersion: typeof header.appVersion === 'string' ? header.appVersion : '',
  };
}

async function startsWithMagic(blob) {
  const b = await readBytes(blob, 0, 4);
  return MAGIC.every((x, i) => b[i] === x);
}

// ---------------------------------------------------------------------------
// Chiavi e record
// ---------------------------------------------------------------------------

async function derivePasswordKey(password, kdf) {
  const argon2id = await loadArgon2();
  // Sul PC la password ha almeno 8 caratteri: vuota è sicuramente sbagliata (e hash-wasm la rifiuterebbe).
  if (!String(password ?? '')) fail('password_errata');
  const message = utf8(String(password).normalize('NFC'));
  let raw;
  try {
    raw = await argon2id({
      password: message,
      salt: fromBase64(kdf.salt),
      parallelism: kdf.parallelism,
      iterations: kdf.passes,
      memorySize: kdf.memory,
      hashLength: 32,
      outputType: 'binary',
    });
  } catch (err) {
    // WebAssembly.Memory non allocabile (telefono con poca memoria libera) o altro errore del motore.
    fail(/memory|memoria|allocat|RangeError/i.test(String(err?.message || err?.name || err)) ? 'memoria' : 'argon2_non_disponibile', err);
  } finally {
    message.fill(0);
  }
  try {
    return await subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  } finally {
    raw.fill(0);
  }
}

async function hkdfKeys(mk) {
  const s = subtle();
  const base = await s.importKey('raw', mk, 'HKDF', false, ['deriveKey']);
  const derive = (info, usages) => s.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(info) },
    base, { name: 'AES-GCM', length: 256 }, false, usages,
  );
  return {
    kTel: await derive(INFO.telefono, ['decrypt']),
    kRipasso: await derive(INFO.ripasso, ['encrypt', 'decrypt']),
    // Chiave HMAC per i codici delle rotte (vedi routeToken)
    kRotte: await s.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(INFO.rotte) },
      base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign'],
    ),
  };
}

/**
 * Codice opaco da mettere nell'indirizzo al posto di un testo personale (il nome di un tag): i primi 12 byte di
 * HMAC-SHA256(kRotte, testo) in base64url (16 caratteri). Senza la password non dice nulla; è lo stesso per la stessa
 * agenda (stessa MK) anche dopo un blocco o con un pacchetto più nuovo, così i link della cronologia restano validi.
 */
export async function routeToken(key, text) {
  const mac = new Uint8Array(await subtle().sign('HMAC', key, utf8(text)));
  return toBase64(mac.subarray(0, 12)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decifra un record "nonce(12) | ciphertext | tag(16)". Lancia un errore se chiave, AAD o dati non corrispondono. */
async function openRecord(key, record, aad) {
  if (record.length < NONCE + TAG) throw new Error('record troppo corto');
  return new Uint8Array(await subtle().decrypt(
    { name: 'AES-GCM', iv: record.subarray(0, NONCE), additionalData: utf8(aad), tagLength: 128 },
    key, record.subarray(NONCE),
  ));
}

/** Cifra un oggetto JSON (AES-256-GCM, nonce casuale): { v: 1, nonce, ct } con byte in base64. */
export async function sealJson(key, obj, aad) {
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE));
  const ct = new Uint8Array(await subtle().encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: utf8(aad), tagLength: 128 }, key, utf8(JSON.stringify(obj)),
  ));
  return { v: 1, nonce: toBase64(nonce), ct: toBase64(ct) };
}

/** Il contrario di sealJson; lancia un errore se la chiave o l'AAD sono diversi o i dati alterati. */
export async function openJson(key, sealed, aad) {
  const nonce = fromBase64(sealed?.nonce);
  const ct = fromBase64(sealed?.ct);
  if (sealed?.v !== 1 || !nonce || nonce.length !== NONCE || !ct) throw new Error('record non valido');
  return JSON.parse(new TextDecoder().decode(await openRecord(key, concat(nonce, ct), aad)));
}

const IMAGE_MIME = /^image\/[a-z0-9.+-]+$/i;

function validIndex(data) {
  const a = data?.archive;
  const obj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  return obj(data) && obj(a) && obj(a.people) && obj(a.groups) && obj(a.events) && obj(a.schema)
    && Array.isArray(a.schema.fields) && Array.isArray(a.schema.sections) && obj(data.files);
}

// ---------------------------------------------------------------------------
// Sblocco
// ---------------------------------------------------------------------------

/**
 * Apre il pacchetto con la password (la stessa del PC). La MK serve solo a ricavare le chiavi e poi viene
 * cancellata: restano due CryptoKey non estraibili (file del pacchetto e progressi del ripasso sul telefono).
 * @param {Blob|Uint8Array|ArrayBuffer} input
 * @param {string} password
 */
export async function unlock(input, password) {
  const blob = toBlob(input);
  const info = await parseHeader(blob);
  const { header, bodyOffset } = info;
  const kek = await derivePasswordKey(password, header.kdf);

  let mk;
  try {
    const w = header.password;
    mk = new Uint8Array(await subtle().decrypt(
      { name: 'AES-GCM', iv: fromBase64(w.nonce), additionalData: utf8(AAD.mk), tagLength: 128 },
      kek, concat(fromBase64(w.ct), fromBase64(w.tag)),
    ));
  } catch (err) {
    fail('password_errata', err);
  }
  let keys;
  try {
    keys = await hkdfKeys(mk);
  } finally {
    mk.fill(0);
  }

  const bodySize = blob.size - bodyOffset;
  const { offset, length } = header.index;
  let data;
  try {
    const record = await readBytes(blob, bodyOffset + offset, bodyOffset + offset + length);
    const plain = await openRecord(keys.kTel, record, AAD.indice);
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await gunzip(plain)));
  } catch (err) {
    fail('file_danneggiato', err);
  }
  if (!validIndex(data)) fail('file_danneggiato');

  const files = data.files;
  const { kTel, kRipasso, kRotte } = keys;
  const archive = data.archive;
  const hasFile = (fileId) => typeof fileId === 'string' && Object.prototype.hasOwnProperty.call(files, fileId);
  return {
    header,
    createdAt: info.createdAt,
    appVersion: info.appVersion,
    size: info.size,
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : info.createdAt,
    revision: Number.isFinite(data.revision) ? data.revision : null,
    archive: {
      settings: archive.settings && typeof archive.settings === 'object' ? archive.settings : {},
      schema: archive.schema,
      people: archive.people,
      groups: archive.groups,
      events: archive.events,
      tagMeta: archive.tagMeta && typeof archive.tagMeta === 'object' ? archive.tagMeta : {},
      review: archive.review && typeof archive.review === 'object' ? archive.review : {},
    },
    files,
    kTel,
    kRipasso,
    kRotte,
    /** true se il pacchetto contiene il file (foto o miniatura). */
    hasFile,
    /** Decifra un file del pacchetto (solo quando serve) → Blob con il suo tipo. */
    async getFile(fileId) {
      const meta = hasFile(fileId) ? files[fileId] : null;
      if (!meta) fail('file_mancante');
      if (!isInt(meta.offset, 0, Number.MAX_SAFE_INTEGER) || !isInt(meta.length, NONCE + TAG, Number.MAX_SAFE_INTEGER)
        || meta.offset + meta.length > bodySize) fail('file_danneggiato');
      let plain;
      try {
        const record = await readBytes(blob, bodyOffset + meta.offset, bodyOffset + meta.offset + meta.length);
        plain = await openRecord(kTel, record, AAD.file(fileId));
      } catch (err) {
        fail('file_danneggiato', err);
      }
      return new Blob([plain], { type: IMAGE_MIME.test(String(meta.mime || '')) ? meta.mime : 'application/octet-stream' });
    },
  };
}
