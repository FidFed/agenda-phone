// Schermate prima dello sblocco: primo avvio (scegli il pacchetto), password, errore.
import { html, useEffect, useRef, useState } from '../html.js';
import { choosePackage, forget, unlockWith, useStore } from '../store.js';
import { loadArgon2 } from '../pacchetto.js';
import { formatBytes, formatDateTime } from '../pc/format.js';
import { Callout, Icon, Spinner, alertDialog, confirmDialog } from '../ui.js';

/** Pulsante che apre il selettore di file (da lì, su Android, si arriva a Google Drive). */
export function PackagePicker({ label, variant = 'primary', onPicked, busyLabel = 'Controllo il file…', className = '' }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const onChange = async (e) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    setBusy(true);
    try {
      await onPicked(file);
    } finally {
      setBusy(false);
    }
  };
  return html`<label class=${`btn btn-${variant} btn-block btn-file ${busy ? 'is-busy' : ''} ${className}`}>
    <input ref=${inputRef} type="file" class="sr-only" onChange=${onChange} disabled=${busy} data-testid="scegli-pacchetto" />
    ${busy ? html`<${Spinner} size=${18} />` : html`<${Icon} name="folder" size=${20} />`}
    <span>${busy ? busyLabel : label}</span>
  </label>`;
}

function Brand({ title = 'Agenda', sub }) {
  return html`<div class="brand">
    <img class="brand-icon" src="icon-192.png" alt="" width="72" height="72" />
    <h1 class="brand-title">${title}</h1>
    ${sub && html`<p class="brand-sub">${sub}</p>`}
  </div>`;
}

export function WelcomeScreen() {
  const notice = useStore((s) => s.notice);
  const [error, setError] = useState('');
  const pick = async (file) => {
    setError('');
    try {
      await choosePackage(file);
    } catch (err) {
      setError(err?.message || 'Non riesco a leggere questo file.');
    }
  };
  return html`<main class="gate">
    <${Brand} sub="La tua agenda delle persone, da consultare anche fuori casa. In sola lettura." />
    ${notice && html`<${Callout} kind=${notice.kind}>${notice.text}</${Callout}>`}
    <div class="gate-card">
      <h2 class="gate-title">Scegli il file del pacchetto</h2>
      <ol class="steps">
        <li>Sul PC, in Agenda › Impostazioni › Telefono, attiva l'esportazione nella cartella di Google Drive.</li>
        <li>Tocca il pulsante qui sotto, scegli <strong>Drive</strong>, apri la cartella <strong>Agenda</strong> e tocca il file <strong class="nowrap">agenda-telefono.agdp</strong>.</li>
        <li>Poi scrivi la password di Agenda: è la stessa del PC.</li>
      </ol>
      <${PackagePicker} label="Scegli il file del pacchetto" onPicked=${pick} />
      ${error && html`<p class="form-error" role="alert">${error}</p>`}
    </div>
    <p class="gate-note"><${Icon} name="shield" size=${16} />
      Il file resta cifrato su questo telefono: senza la password nessuno può leggerlo. La web app non invia nulla a nessuno.</p>
  </main>`;
}

export function LockScreen() {
  const pkg = useStore((s) => s.pkg);
  const notice = useStore((s) => s.notice);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pickError, setPickError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    loadArgon2().catch(() => {}); // intanto che scrivi la password
    inputRef.current?.focus();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!password) { setError('Scrivi la password.'); inputRef.current?.focus(); return; }
    setError('');
    setBusy(true);
    // lascia disegnare "Apro l'agenda…" prima del calcolo della chiave (qualche secondo sul telefono)
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
    try {
      const { olderThan } = (await unlockWith(password)) || {};
      if (olderThan) {
        alertDialog({
          title: 'Questo pacchetto è più vecchio',
          message: `Contiene dati più vecchi di quelli che avevi aperto l'ultima volta su questo telefono (pacchetto del ${formatDateTime(olderThan)}). `
            + 'Se non l\'hai scelto tu apposta, qualcuno potrebbe aver rimesso una copia vecchia nella cartella: sul PC tocca «Aggiorna ora», '
            + 'poi qui «Aggiorna il pacchetto».',
        });
      }
    } catch (err) {
      setBusy(false);
      setError(err?.message || 'Non sono riuscito ad aprire il pacchetto.');
      setPassword('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const update = async (file) => {
    setPickError('');
    try {
      await choosePackage(file);
      setError('');
      setPassword('');
      inputRef.current?.focus();
    } catch (err) {
      setPickError(err?.message || 'Non riesco a leggere questo file.');
    }
  };

  const doForget = async () => {
    const ok = await confirmDialog({
      title: 'Dimenticare il pacchetto?',
      message: 'Cancello da questo telefono il pacchetto cifrato e i progressi del ripasso fatti qui. Sul PC non cambia niente: potrai sceglierlo di nuovo da Google Drive.',
      confirmText: 'Dimentica',
      danger: true,
    });
    if (ok) await forget();
  };

  return html`<main class="gate">
    <${Brand} sub=${pkg?.createdAt ? `Dati del ${formatDateTime(pkg.createdAt)}` : ''} />
    ${notice && html`<${Callout} kind=${notice.kind}>${notice.text}</${Callout}>`}
    <form class="gate-card" onSubmit=${submit} autocomplete="off">
      <label class="field-label" for="password">Password di Agenda</label>
      <div class="password">
        <input ref=${inputRef} id="password" class="input" type=${show ? 'text' : 'password'} value=${password}
          autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck=${false} enterkeyhint="go"
          disabled=${busy} aria-invalid=${error ? 'true' : 'false'} aria-describedby=${error ? 'password-error' : undefined}
          onInput=${(e) => setPassword(e.currentTarget.value)} />
        <button type="button" class="icon-btn password-eye" aria-label=${show ? 'Nascondi la password' : 'Mostra la password'}
          aria-pressed=${show ? 'true' : 'false'} onClick=${() => setShow(!show)} disabled=${busy}>
          <${Icon} name=${show ? 'eye-off' : 'eye'} size=${20} />
        </button>
      </div>
      ${error && html`<p id="password-error" class="form-error" role="alert">${error}</p>`}
      <button type="submit" class="btn btn-primary btn-block btn-l" disabled=${busy}>
        ${busy ? html`<${Spinner} size=${18} /><span>Apro l'agenda…</span>` : html`<${Icon} name="unlock" size=${20} /><span>Apri</span>`}
      </button>
      <p class="gate-hint">È la stessa password del PC. Dopo 5 minuti senza usarla, o 1 minuto in un'altra app, Agenda si blocca da sola.
        Se Chrome propone di salvarla, rispondi di no: finirebbe nel tuo account Google, lo stesso del pacchetto.</p>
    </form>
    <div class="gate-more">
      <${PackagePicker} label="Aggiorna il pacchetto" variant="secondary" onPicked=${update} />
      ${pickError && html`<p class="form-error" role="alert">${pickError}</p>`}
      ${pkg?.size ? html`<p class="gate-note">Pacchetto sul telefono: ${formatBytes(pkg.size)}${pkg.appVersion ? ` · da Agenda ${pkg.appVersion}` : ''}</p>` : null}
      <button type="button" class="btn btn-ghost-danger btn-block" onClick=${doForget}>
        <${Icon} name="trash" size=${18} /><span>Dimentica il pacchetto da questo telefono</span>
      </button>
    </div>
  </main>`;
}

export function ErrorScreen({ message }) {
  return html`<main class="gate">
    <${Brand} />
    <${Callout} kind="danger" title="Non posso partire">${message}</${Callout}>
  </main>`;
}
