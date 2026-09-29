/* GON form-sync 1.0.0: a cloud refresh must never reset an in-progress form. */
const gonSelectSources = new WeakMap();

function gonSelectNotice(el) {
  const opt = el.selectedOptions[0];
  const unavailable = Boolean(opt && opt.dataset.gonUnavailable === 'true');
  const message = unavailable
    ? 'La voce selezionata non è più disponibile. Scegli un altro valore prima di salvare.'
    : '';
  // Report filters can legitimately reference a historical/deleted client.
  el.setCustomValidity(el.id === 'rclient' ? '' : message);
  let note = document.getElementById('gon-select-notice-' + el.id);
  if (!note && unavailable) {
    note = document.createElement('small');
    note.id = 'gon-select-notice-' + el.id;
    note.setAttribute('role', 'status');
    note.style.cssText = 'color:#b42318;font-size:12px;margin-top:4px';
    el.insertAdjacentElement('afterend', note);
    const ids = new Set((el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    ids.add(note.id);
    el.setAttribute('aria-describedby', [...ids].join(' '));
  }
  if (note) {
    note.textContent = el.id === 'rclient' && unavailable
      ? 'Cliente non presente in anagrafica: il filtro resta applicato.'
      : message;
    note.hidden = !unavailable;
  }
}

function gonSyncSelect(id, source) {
  const el = document.getElementById(id);
  if (!el) throw new Error('Campo mancante: ' + id);
  if (!gonSelectSources.has(el)) {
    el.addEventListener('change', () => gonSelectNotice(el));
  }
  if (gonSelectSources.get(el) !== source) {
    // Capture at render time, AFTER the asynchronous fetch completes. A value
    // selected while the request was in flight must not be overwritten.
    const previous = el.value;
    const selected = el.selectedOptions[0];
    const hadOptions = el.options.length > 0;
    const label = selected ? (selected.dataset.gonOriginalLabel || selected.textContent) : previous;
    el.innerHTML = source;
    if (hadOptions && Array.from(el.options).some(o => o.value === previous)) {
      el.value = previous;
    } else if (hadOptions && previous !== '') {
      // Do not silently reset a client removed by another operator. Preserve
      // the draft visibly, but block submission until a valid choice is made.
      const fallback = new Option(label + ' (non disponibile)', previous, false, true);
      fallback.disabled = true;
      fallback.dataset.gonUnavailable = 'true';
      fallback.dataset.gonOriginalLabel = label;
      el.add(fallback);
      el.value = previous;
    }
    gonSelectSources.set(el, source);
  }
  gonSelectNotice(el);
}

function gonValidateFormSelections() {
  for (const id of ['client', 'macro']) {
    const el = document.getElementById(id);
    if (!el) return false;
    gonSelectNotice(el);
    if (!el.checkValidity()) { el.reportValidity(); return false; }
  }
  return true;
}
