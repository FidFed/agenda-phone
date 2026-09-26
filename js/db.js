// IndexedDB del telefono: un solo archivio chiave → valore.
//   "pacchetto" → { blob, createdAt, appVersion, size, savedAt }   il pacchetto ANCORA CIFRATO, così come arriva da Drive
//   "ripasso"   → { v, nonce, ct }                                 progressi del ripasso sul telefono, cifrati
//   "visto"     → { v, nonce, ct }                                 data e revisione dell'ultimo pacchetto aperto, cifrate
//                                                                  (per accorgersi se ne viene rimesso uno più vecchio)
// Nessun dato in chiaro viene mai scritto qui.

const DB_NAME = 'agenda-telefono';
const STORE = 'dati';

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('database bloccato'));
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result;
    const req = fn(tx.objectStore(STORE));
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transazione annullata'));
  });
}

export const dbGet = (key) => run('readonly', (s) => s.get(key));
export const dbPut = (key, value) => run('readwrite', (s) => s.put(value, key));
export const dbDelete = (key) => run('readwrite', (s) => s.delete(key));

/** Cancella tutto il database (pacchetto e progressi del ripasso). */
export async function dbDestroy() {
  if (dbPromise) {
    try { (await dbPromise).close(); } catch { /* ignora */ }
    dbPromise = null;
  }
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}
