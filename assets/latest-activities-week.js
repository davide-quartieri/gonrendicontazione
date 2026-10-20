/* Limit the legacy "Ultime attività" panel to the last seven activity dates. */
(() => {
  'use strict';

  const VERSION = 'latest-activities-week-1.0.0';
  const DAYS = 7;
  const $ = id => document.getElementById(id);
  let observer = null;
  let rootObserver = null;
  let scheduled = false;
  let busy = false;

  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function findCard() {
    const heading = [...document.querySelectorAll('h2')]
      .find(node => normalize(node.textContent) === 'Ultime attività');
    return heading ? (heading.closest('.card') || heading.parentElement) : null;
  }

  function parseDate(value) {
    const text = normalize(value);
    let match = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/);
    if (match) {
      const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    match = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (match) {
      const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
  }

  function windowDates() {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (DAYS - 1));
    return { start, end };
  }

  function ensureStyle() {
    if ($('gonLatestWeekStyle')) return;
    const style = document.createElement('style');
    style.id = 'gonLatestWeekStyle';
    style.textContent = `
      .gon-latest-week-note{margin:4px 0 12px;color:#667085;font-size:13px}
      .gon-latest-week-count{display:inline-flex;margin-left:7px;padding:2px 7px;border-radius:999px;background:#eaf3fa;color:#155f96;font-weight:800;font-size:11px;vertical-align:middle}
      tr.gon-latest-week-empty td{text-align:center;color:#667085;padding:18px!important}
    `;
    document.head.append(style);
  }

  function ensureNote(card) {
    const heading = [...card.querySelectorAll('h2')]
      .find(node => normalize(node.textContent) === 'Ultime attività');
    if (!heading) return null;
    let note = card.querySelector('[data-gon-latest-week-note]');
    if (!note) {
      note = document.createElement('p');
      note.className = 'gon-latest-week-note';
      note.dataset.gonLatestWeekNote = '1';
      note.innerHTML = `Sono mostrate solo le attività con data negli ultimi ${DAYS} giorni.<span class="gon-latest-week-count" data-gon-latest-week-count></span>`;
      heading.insertAdjacentElement('afterend', note);
    }
    return note;
  }

  function rowDate(row) {
    const explicit = row.dataset.date || row.querySelector('[data-date]')?.dataset.date;
    if (explicit) {
      const parsed = parseDate(explicit);
      if (parsed) return parsed;
    }
    const firstCell = row.querySelector('td');
    return parseDate(firstCell?.textContent || row.textContent);
  }

  function applyFilter() {
    scheduled = false;
    if (busy) return;
    const card = findCard();
    if (!card) return;

    busy = true;
    try {
      ensureStyle();
      const note = ensureNote(card);
      const { start, end } = windowDates();
      let visible = 0;
      let considered = 0;

      for (const tbody of card.querySelectorAll('tbody')) {
        tbody.querySelectorAll('tr.gon-latest-week-empty').forEach(row => row.remove());
        const rows = [...tbody.querySelectorAll(':scope > tr')];
        let bodyVisible = 0;

        for (const row of rows) {
          if (!row.querySelector('td')) continue;
          const date = rowDate(row);
          const show = Boolean(date && date >= start && date <= end);
          row.hidden = !show;
          considered += 1;
          if (show) {
            visible += 1;
            bodyVisible += 1;
          }
        }

        if (rows.length && bodyVisible === 0) {
          const empty = document.createElement('tr');
          empty.className = 'gon-latest-week-empty';
          const cell = document.createElement('td');
          cell.colSpan = Math.max(1, tbody.closest('table')?.querySelectorAll('thead th').length || 1);
          cell.textContent = `Nessuna attività con data negli ultimi ${DAYS} giorni.`;
          empty.append(cell);
          tbody.append(empty);
        }
      }

      const badge = note?.querySelector('[data-gon-latest-week-count]');
      if (badge) badge.textContent = considered ? `${visible} ${visible === 1 ? 'attività' : 'attività'}` : '';
      card.dataset.gonLatestWeek = '1';
      observeCard(card);
    } finally {
      busy = false;
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(applyFilter);
  }

  function observeCard(card) {
    observer?.disconnect();
    observer = new MutationObserver(schedule);
    observer.observe(card, { childList: true, subtree: true, characterData: true });
  }

  function boot() {
    schedule();
    rootObserver = new MutationObserver(() => {
      if (findCard()) {
        schedule();
        rootObserver?.disconnect();
      }
    });
    rootObserver.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('gon:data-refreshed', schedule);
    window.addEventListener('pageshow', schedule);
    setInterval(schedule, 15000);
  }

  window.GonLatestActivitiesWeek = Object.freeze({ version: VERSION, refresh: schedule, days: DAYS });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
