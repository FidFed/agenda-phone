// Componenti condivisi della web app del telefono (mobile-first, solo lettura).
import { html, useEffect, useRef, useState } from './html.js';
import { ICONS } from './pc/icons.js';
import { displayName, tagColor } from './pc/domain.js';
import { goBack, tagHref } from './router.js';
import { Photo } from './photos.js';

// ---------------------------------------------------------------------------
// Icone e piccoli elementi
// ---------------------------------------------------------------------------

export function Icon({ name, size = 20, className = '', strokeWidth = 1.8, title }) {
  return html`<svg class=${`icon ${className}`} width=${size} height=${size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width=${strokeWidth} stroke-linecap="round" stroke-linejoin="round"
    aria-hidden=${title ? undefined : 'true'} role=${title ? 'img' : undefined} aria-label=${title || undefined}
    dangerouslySetInnerHTML=${{ __html: ICONS[name] || '' }}></svg>`;
}

export function Spinner({ size = 20 }) {
  return html`<span class="spinner" style=${`width:${size}px;height:${size}px`} aria-hidden="true"></span>`;
}

/** Barra in alto di ogni schermata: indietro (se `back`), titolo, azioni; nelle sezioni principali le Impostazioni. */
export function TopBar({ title, subtitle, back, actions, children }) {
  const gear = !back && html`<a class="icon-btn" href="#/impostazioni" aria-label="Impostazioni"><${Icon} name="settings" size=${22} /></a>`;
  return html`<header class="topbar">
    <div class="topbar-row">
      ${back && html`<button type="button" class="icon-btn topbar-back" aria-label="Indietro"
        onClick=${() => goBack(typeof back === 'string' ? back : '#/persone')}><${Icon} name="chevron-left" size=${24} /></button>`}
      <div class="topbar-titles">
        <h1 class="topbar-title">${title}</h1>
        ${subtitle && html`<p class="topbar-sub">${subtitle}</p>`}
      </div>
      ${(actions || gear) && html`<div class="topbar-actions">${actions}${gear}</div>`}
    </div>
    ${children}
  </header>`;
}

export function TagChip({ archive, name, href, onClick, active = false, count, removable = false, size }) {
  const color = tagColor(archive, name);
  const cls = `tag-chip ${active ? 'is-active' : ''} ${size === 's' ? 'tag-chip-s' : ''}`;
  const body = html`<span class="tag-dot" aria-hidden="true"></span><span class="tag-name">${name}</span>${count !== undefined && html`<span class="tag-count">${count}</span>`}${removable && html`<${Icon} name="x" size=${14} />`}`;
  if (href) return html`<a class=${cls} data-color=${color} href=${href}>${body}</a>`;
  if (onClick) {
    return html`<button type="button" class=${cls} data-color=${color} aria-pressed=${active ? 'true' : 'false'}
      onClick=${() => onClick(name)}>${body}</button>`;
  }
  return html`<span class=${cls} data-color=${color}>${body}</span>`;
}

export function TagList({ archive, tags, linked = true }) {
  const list = (tags || []).filter((t) => String(t || '').trim());
  if (!list.length) return null;
  return html`<div class="tag-list">
    ${list.map((t) => html`<${TagChip} key=${t} archive=${archive} name=${t} href=${linked ? tagHref(t) : undefined} />`)}
  </div>`;
}

export function EmptyState({ icon = 'info', title, text, children }) {
  return html`<div class="empty">
    <span class="empty-icon" aria-hidden="true"><${Icon} name=${icon} size=${28} /></span>
    <p class="empty-title">${title}</p>
    ${text && html`<p class="empty-text">${text}</p>`}
    ${children}
  </div>`;
}

export function Callout({ kind = 'info', icon, title, children, className = '' }) {
  const ic = icon || { accent: 'star', danger: 'alert', warning: 'alert', success: 'check-circle', info: 'info' }[kind];
  return html`<div class=${`callout callout-${kind} ${className}`} role=${kind === 'danger' || kind === 'warning' ? 'note' : undefined}>
    <span class="callout-icon" aria-hidden="true"><${Icon} name=${ic} size=${18} /></span>
    <div class="callout-body">
      ${title && html`<p class="callout-title">${title}</p>`}
      <div class="callout-text">${children}</div>
    </div>
  </div>`;
}

export function Section({ title, icon, count, children, className = '', action }) {
  return html`<section class=${`section ${className}`}>
    <div class="section-head">
      <h2 class="section-title">${icon && html`<${Icon} name=${icon} size=${17} />`}<span>${title}</span>${count !== undefined && html`<span class="section-count">${count}</span>`}</h2>
      ${action}
    </div>
    <div class="section-body">${children}</div>
  </section>`;
}

/** Riga di elenco toccabile (persona, gruppo, evento). */
export function Row({ href, leading, title, sub, meta, extra, className = '' }) {
  return html`<a class=${`row ${className}`} href=${href}>
    ${leading && html`<span class="row-lead">${leading}</span>`}
    <span class="row-main">
      <span class="row-title">${title}</span>
      ${sub && html`<span class="row-sub">${sub}</span>`}
      ${extra && html`<span class="row-extra">${extra}</span>`}
    </span>
    ${meta && html`<span class="row-meta">${meta}</span>`}
    <${Icon} name="chevron-right" size=${18} className="row-chevron" />
  </a>`;
}

export function PersonRow({ archive, person, sub, extra, meta }) {
  return html`<${Row} href=${`#/persona/${encodeURIComponent(person.id)}`} className="row-person"
    leading=${html`<${Photo} person=${person} size=${48} round />`}
    title=${displayName(person)} sub=${sub} extra=${extra} meta=${meta} />`;
}


/** Campo di ricerca grande (con pulsante per svuotare). onInput riceve il testo. */
export function SearchBox({ value, onInput, placeholder, label, inputRef }) {
  return html`<div class="search">
    <${Icon} name="search" size=${19} className="search-icon" />
    <input ref=${inputRef} type="search" class="search-input" value=${value} placeholder=${placeholder}
      aria-label=${label || placeholder} autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck=${false}
      enterkeyhint="search" onInput=${(e) => onInput(e.currentTarget.value)} />
    ${value && html`<button type="button" class="icon-btn search-clear" aria-label="Cancella la ricerca"
      onClick=${() => { onInput(''); inputRef?.current?.focus(); }}><${Icon} name="x" size=${18} /></button>`}
  </div>`;
}

/** Pulsanti a scelta singola. options = [{ value, label }] */
export function Segmented({ value, options, onChange, label, className = '' }) {
  return html`<div class=${`segmented ${className}`} role="radiogroup" aria-label=${label}>
    ${options.map((o) => html`<button key=${o.value} type="button" role="radio" aria-checked=${o.value === value ? 'true' : 'false'}
      class=${`segmented-btn ${o.value === value ? 'is-on' : ''}`} onClick=${() => onChange(o.value)}>
      ${o.icon && html`<${Icon} name=${o.icon} size=${16} />`}${o.label}</button>`)}
  </div>`;
}

/** Rendering a blocchi per elenchi lunghi: `limit` cresce quando la sentinella entra in vista. */
export function useIncremental(total, resetKey, step = 60, initial) {
  const [limit, setLimit] = useState(() => Math.max(step, initial || 0));
  const sentinelRef = useRef(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setLimit(step);
  }, [resetKey]);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || limit >= total || typeof IntersectionObserver !== 'function') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setLimit((l) => Math.min(total, l + step));
    }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [limit, total]);
  return { limit, sentinelRef, more: () => setLimit((l) => Math.min(total, l + step)) };
}

/** Ricorda la posizione di scorrimento di una schermata (per tornare dove eri dopo un profilo). */
const scrollMemory = new Map();
export function useScrollMemory(key) {
  useEffect(() => {
    const y = scrollMemory.get(key);
    if (y) requestAnimationFrame(() => window.scrollTo(0, y));
    else window.scrollTo(0, 0);
    return () => { scrollMemory.set(key, window.scrollY); };
  }, [key]);
}
export const clearScrollMemory = () => scrollMemory.clear();

// ---------------------------------------------------------------------------
// Dialoghi e avvisi (un solo contenitore, reso da main.js)
// ---------------------------------------------------------------------------

let overlay = { dialog: null, toast: null };
const overlayListeners = new Set();
function setOverlay(patch) {
  overlay = { ...overlay, ...patch };
  for (const fn of overlayListeners) fn(overlay);
}

/** Conferma → Promise<boolean>. */
export function confirmDialog({ title, message, confirmText = 'Conferma', cancelText = 'Annulla', danger = false }) {
  return new Promise((resolve) => {
    const done = (v) => { setOverlay({ dialog: null }); resolve(v); };
    setOverlay({ dialog: { title, message, confirmText, cancelText, danger, done } });
  });
}

/** Avviso con un solo pulsante → Promise che si risolve alla chiusura. */
export function alertDialog({ title, message, confirmText = 'Ho capito' }) {
  return confirmDialog({ title, message, confirmText, cancelText: null }).then(() => {});
}

let toastTimer = null;
export function toast(text, kind = 'info') {
  clearTimeout(toastTimer);
  setOverlay({ toast: { text, kind, id: Date.now() } });
  toastTimer = setTimeout(() => setOverlay({ toast: null }), 4000);
}

export function closeOverlays() {
  if (overlay.dialog) overlay.dialog.done(false);
  clearTimeout(toastTimer);
  setOverlay({ dialog: null, toast: null });
}

export function Overlays() {
  const [o, setO] = useState(overlay);
  useEffect(() => {
    overlayListeners.add(setO);
    return () => overlayListeners.delete(setO);
  }, []);
  const confirmRef = useRef(null);
  useEffect(() => { if (o.dialog) confirmRef.current?.focus(); }, [o.dialog]);
  useEffect(() => {
    if (!o.dialog) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') o.dialog.done(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [o.dialog]);
  return html`
    ${o.dialog && html`<div class="sheet-backdrop" onClick=${(e) => { if (e.target === e.currentTarget) o.dialog.done(false); }}>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 id="dialog-title" class="sheet-title">${o.dialog.title}</h2>
        ${o.dialog.message && html`<p class="sheet-text">${o.dialog.message}</p>`}
        <div class="sheet-actions">
          ${o.dialog.cancelText && html`<button type="button" class="btn btn-secondary" onClick=${() => o.dialog.done(false)}>${o.dialog.cancelText}</button>`}
          <button type="button" ref=${confirmRef} class=${`btn ${o.dialog.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick=${() => o.dialog.done(true)}>${o.dialog.confirmText}</button>
        </div>
      </div>
    </div>`}
    ${o.toast && html`<div class=${`toast toast-${o.toast.kind}`} role="status" key=${o.toast.id}>${o.toast.text}</div>`}`;
}

// ---------------------------------------------------------------------------
// Visore delle foto a tutto schermo
// ---------------------------------------------------------------------------

export function PhotoViewer({ photos, index = 0, onClose, label = 'Foto' }) {
  const [i, setI] = useState(index);
  const n = photos.length;
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((x) => (x + 1) % n);
      if (e.key === 'ArrowLeft') setI((x) => (x - 1 + n) % n);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [n]);
  const touch = useRef(null);
  return html`<div class="viewer" role="dialog" aria-modal="true" aria-label=${label}
    onTouchStart=${(e) => { touch.current = e.touches[0]?.clientX ?? null; }}
    onTouchEnd=${(e) => {
      const x0 = touch.current;
      const x1 = e.changedTouches[0]?.clientX;
      if (x0 == null || x1 == null || n < 2) return;
      if (x1 - x0 > 50) setI((x) => (x - 1 + n) % n);
      if (x0 - x1 > 50) setI((x) => (x + 1) % n);
    }}>
    <div class="viewer-bar">
      <span class="viewer-count">${n > 1 ? `${i + 1} di ${n}` : ''}</span>
      <button type="button" ref=${closeRef} class="icon-btn viewer-close" aria-label="Chiudi" onClick=${onClose}>
        <${Icon} name="x" size=${26} />
      </button>
    </div>
    <div class="viewer-stage" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <${Photo} key=${i} photoRef=${photos[i]} big lazy=${false} size=${null} className="viewer-photo" alt=${`${label} ${i + 1} di ${n}`} />
    </div>
    ${n > 1 && html`<div class="viewer-nav">
      <button type="button" class="icon-btn" aria-label="Foto precedente" onClick=${() => setI((x) => (x - 1 + n) % n)}><${Icon} name="chevron-left" size=${28} /></button>
      <button type="button" class="icon-btn" aria-label="Foto successiva" onClick=${() => setI((x) => (x + 1) % n)}><${Icon} name="chevron-right" size=${28} /></button>
    </div>`}
  </div>`;
}

/** Miniature toccabili che aprono il visore. */
export function PhotoStrip({ photos, label }) {
  const [open, setOpen] = useState(null);
  const list = (photos || []).filter((p) => p && (p.fileId || p.thumbId));
  if (!list.length) return null;
  return html`<div class="thumbs">
    ${list.map((p, i) => html`<button key=${p.fileId || p.thumbId} type="button" class="thumb" aria-label=${`Apri la foto ${i + 1} di ${list.length}`}
      onClick=${() => setOpen(i)}><${Photo} photoRef=${p} size=${null} /></button>`)}
    ${open !== null && html`<${PhotoViewer} photos=${list} index=${open} label=${label} onClose=${() => setOpen(null)} />`}
  </div>`;
}

/** Documenti: sul telefono non ci sono (SPEC §11.1). */
export function DocumentsNote({ count }) {
  if (!count) return null;
  return html`<div class="docs-note">
    <${Icon} name="file" size=${18} />
    <span>${count === 1 ? '1 documento · disponibile' : `${count} documenti · disponibili`} solo sul PC</span>
  </div>`;
}
