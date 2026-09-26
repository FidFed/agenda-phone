// Impostazioni (minime): data del pacchetto, "Aggiorna il pacchetto", "Blocca", "Dimentica il pacchetto".
import { html, useState } from '../html.js';
import { choosePackage, forget, lock, phoneReviewCount, useStore } from '../store.js';
import { formatBytes, formatDateTime, plural } from '../pc/format.js';
import { Callout, Icon, Section, TopBar, confirmDialog, useScrollMemory } from '../ui.js';
import { PackagePicker } from './avvio.js';
import { VERSIONE } from '../versione.js';
import { BACKGROUND_MS, IDLE_MS } from '../autolock.js';

const THEME_LABEL = { dark: 'scuro', light: 'chiaro', system: 'come il sistema' };

export function SettingsScreen() {
  const info = useStore((s) => s.info);
  const archive = useStore((s) => s.archive);
  const [error, setError] = useState('');
  useScrollMemory('impostazioni');

  const update = async (file) => {
    setError('');
    try {
      await choosePackage(file);
    } catch (err) {
      setError(err?.message || 'Non riesco a leggere questo file.');
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
  const people = Object.keys(archive?.people || {}).length;
  const phoneReviews = phoneReviewCount();

  return html`<div class="screen">
    <${TopBar} title="Impostazioni" back="#/persone" />
    <div class="content">
      <${Section} title="Pacchetto" icon="folder">
        <dl class="kv">
          <div class="kv-row"><dt>Dati aggiornati al</dt><dd data-testid="data-pacchetto">${info?.exportedAt ? formatDateTime(info.exportedAt) : '—'}</dd></div>
          <div class="kv-row"><dt>Contenuto</dt><dd>${plural(people, 'persona', 'persone')} · ${plural(info?.thumbs || 0, 'miniatura', 'miniature')}${info?.photos ? ` · ${plural(info.photos, 'foto grande', 'foto grandi')}` : ''}</dd></div>
          <div class="kv-row"><dt>Dimensione</dt><dd>${formatBytes(info?.size || 0)}${info?.appVersion ? ` · preparato da Agenda ${info.appVersion}` : ''}</dd></div>
        </dl>
        <p class="muted small">Sul PC Agenda aggiorna il pacchetto in Google Drive quando la blocchi o la chiudi. Per avere qui i dati nuovi,
          sceglilo di nuovo: cartella <strong>Agenda</strong>, file <strong>agenda-telefono.agdp</strong>.</p>
        <${PackagePicker} label="Aggiorna il pacchetto" variant="secondary" onPicked=${update} />
        ${error && html`<p class="form-error" role="alert">${error}</p>`}
      </${Section}>

      <${Section} title="Sicurezza" icon="shield">
        <p class="muted small">Agenda si blocca da sola dopo ${IDLE_MS / 60000} minuti senza usarla e dopo ${BACKGROUND_MS / 60000 === 1 ? 'un minuto' : `${BACKGROUND_MS / 60000} minuti`} in un'altra app.
          Bloccata, sul telefono resta solo il pacchetto cifrato.</p>
        <button type="button" class="btn btn-primary btn-block" onClick=${() => lock('manuale')}><${Icon} name="lock" size=${18} />Blocca ora</button>
      </${Section}>

      <${Section} title="Ripasso" icon="cards">
        <p class="muted small">I progressi del ripasso fatti qui restano su questo telefono, cifrati, e partono da quelli del PC.
          ${phoneReviews ? ` Finora: ${plural(phoneReviews, 'persona ripassata', 'persone ripassate')} sul telefono.` : ''}</p>
      </${Section}>

      <${Callout} kind="info" title="Sola lettura">Qui consulti l'agenda: aggiunte e modifiche si fanno sul PC. I documenti (PDF e altri file) restano solo sul PC.
        Tema: ${THEME_LABEL[archive?.settings?.theme] || 'scuro'}, come sul PC.</${Callout}>

      <button type="button" class="btn btn-ghost-danger btn-block" onClick=${doForget}>
        <${Icon} name="trash" size=${18} /><span>Dimentica il pacchetto da questo telefono</span>
      </button>
      <p class="stamp">Agenda per il telefono · versione ${VERSIONE} · <a class="link" href="LICENZE.txt" target="_blank" rel="noopener">licenze</a></p>
    </div>
  </div>`;
}
