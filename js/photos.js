// Foto del pacchetto: decifrate SOLO quando servono (una slice del Blob + AES-GCM), mostrate con URL blob: e
// dimenticate al blocco. Cache LRU degli URL e al massimo qualche decifratura in parallelo.
import { html, useEffect, useRef, useState } from './html.js';
import { initials, initialsOf, hashString } from './pc/domain.js';

const MAX_CACHED = 400;
const MAX_PARALLEL = 6;

let source = null; // sessione del pacchetto (getFile/hasFile) finché è sbloccato
const cache = new Map(); // fileId → Promise<string|null>
let running = 0;
const queue = [];

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const job = queue.shift();
    running++;
    job().finally(() => { running--; pump(); });
  }
}

function limited(fn) {
  return new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject));
    pump();
  });
}

function revoke(promise) {
  promise.then((url) => { if (url) URL.revokeObjectURL(url); }, () => {});
}

export function setPhotoSource(session) {
  source = session;
}

/** Al blocco: revoca tutti gli URL e dimentica la sessione. */
export function clearPhotos() {
  source = null;
  for (const p of cache.values()) revoke(p);
  cache.clear();
  queue.length = 0;
}

export const hasFile = (id) => !!(id && source && source.hasFile(id));

/** URL blob: del file (Promise<string|null>): null se non è nel pacchetto o non si decifra. */
export function fileUrl(fileId) {
  if (!hasFile(fileId)) return Promise.resolve(null);
  const hit = cache.get(fileId);
  if (hit) {
    cache.delete(fileId);
    cache.set(fileId, hit);
    return hit;
  }
  const src = source;
  const p = limited(() => src.getFile(fileId))
    .then((blob) => (source === src ? URL.createObjectURL(blob) : null))
    .catch(() => null);
  cache.set(fileId, p);
  while (cache.size > MAX_CACHED) {
    const [oldest, op] = cache.entries().next().value;
    cache.delete(oldest);
    revoke(op);
  }
  return p;
}

/** Il file da mostrare per una PhotoRef: miniatura (piccola) o foto grande, con ripiego sull'altra. */
export function pickFile(ref, big = false) {
  if (!ref) return null;
  const order = big ? [ref.fileId, ref.thumbId] : [ref.thumbId, ref.fileId];
  return order.find((id) => hasFile(id)) || null;
}

export const mainPhoto = (entity) => (Array.isArray(entity?.photos) ? entity.photos.find((p) => p && (p.fileId || p.thumbId)) : null) || null;

/** Hook: URL della foto (undefined = in caricamento, null = assente). `lazy`: solo quando l'elemento è visibile. */
export function usePhotoUrl(fileId, elRef = null) {
  const [url, setUrl] = useState(() => (fileId ? undefined : null));
  const [visible, setVisible] = useState(!elRef);
  useEffect(() => {
    if (!elRef || visible) return undefined;
    const el = elRef.current;
    if (!el || typeof IntersectionObserver !== 'function') { setVisible(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [elRef, visible]);
  useEffect(() => {
    if (!fileId) { setUrl(null); return undefined; }
    if (!visible) return undefined;
    let alive = true;
    setUrl(undefined);
    fileUrl(fileId).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [fileId, visible]);
  return url;
}

/**
 * Foto (o iniziali su un colore) di una persona, un gruppo o un evento.
 *   <${Photo} person=${p} size=${48} />   <${Photo} group=${g} />   <${Photo} photoRef=${ref} big />
 * `lazy` (default) decifra solo quando è vicina allo schermo; `big` usa la foto grande se c'è.
 */
export function Photo({ person, group, event, photoRef, size = 48, big = false, lazy = true, className = '', round = false, alt = '' }) {
  const entity = person || group || event;
  const ref = photoRef || mainPhoto(entity);
  const fileId = pickFile(ref, big);
  const elRef = useRef(null);
  const url = usePhotoUrl(fileId, lazy ? elRef : null);
  const label = person
    ? initials(person)
    : initialsOf(group ? group.name : event ? event.title : '');
  const seed = person ? `${person.firstName} ${person.lastName} ${person.nickname}` : group?.name || event?.title || '';
  const style = typeof size === 'number' ? `width:${size}px;height:${size}px;font-size:${Math.max(11, Math.round(size * 0.36))}px` : '';
  const cls = `photo ${round ? 'photo-round' : ''} ${className}`;
  if (url) {
    return html`<span class=${cls} style=${style} ref=${elRef}>
      <img src=${url} alt=${alt} decoding="async" draggable="false" />
    </span>`;
  }
  return html`<span class=${`${cls} photo-initials ${fileId && url === undefined ? 'is-loading' : ''}`} style=${style}
    data-color=${hashString(seed) % 8} ref=${elRef} aria-hidden=${alt ? undefined : 'true'} role=${alt ? 'img' : undefined}
    aria-label=${alt || undefined}>${fileId && url === undefined ? '' : label}</span>`;
}
