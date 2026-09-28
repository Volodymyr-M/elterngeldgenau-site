// The month grid and its chooser (migration plan §1.9, marketing §6.3).
// One renderer, two orientations: from 600 px a <table> with a row per
// parent and a column per month of life (CSS hides the amounts and shows
// the summary strip below 1024 px, where the table scrolls with the row
// headers pinned); below 600 px the same table transposed, months as rows.
// Every editable cell is a <button> named by core (PlanView.cellNames);
// the grid is one tab stop (roving tabindex; arrows, Home, End); Enter or
// Space opens the chooser, a native <dialog>. Each cell shows its letter,
// and maternity months are hatched: colour is never the only signal. The
// fills are site.css's .months tokens (.cell .c-a .c-ah .c-bonus .c-m …).
// No text is composed here: names, amounts and labels come from core or
// from the page.

export const byParent = matchMedia('(min-width: 600px)');

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = v;
    else e.setAttribute(k === 'cls' ? 'class' : k, v === true ? '' : v);
  }
  e.append(...kids);
  return e;
}

// The site's cell fill for a letter of parent `p` (a or b).
function fill(letter, p, maternity) {
  const c = p === 'a' ? 'a' : 'b';
  const cls =
    letter === 'B' ? (maternity ? 'c-m' : `c-${c}`)
    : letter === 'P' ? `c-${c}h`
    : letter === '+' ? 'c-bonus'
    : maternity ? 'c-x' : '';
  return el('span', { cls: `cell ${cls}`, 'aria-hidden': 'true' });
}

export function legend(ul, view) {
  const items = view.kinds.map((k) => [k.letter, k.name, fill(k.letter, 'a', false)]);
  if (view.maternityLabel) items.push(['', view.maternityLabel, fill('B', 'a', true)]);
  ul.replaceChildren(
    ...items.map(([letter, name, sw]) => el('li', {}, sw, el('span', { text: letter ? `${show(letter)} ${name}` : name }))),
  );
}

const show = (letter) => (letter === '-' ? '–' : letter);

// Renders `plan` (PlanView) into `host`. o: {view, plan, months, labelledby,
// label? (the table's own accessible name), life (column header text),
// onChoose(p, month)?, focus?{p, m}, refocus?}.
// Returns {cell(p, m)}.
export function renderGrid(host, o) {
  const keys = o.view.parents.map((p) => p.engineId);
  const names = o.view.parents.map((p) => p.name);
  const rows = byParent.matches;
  const n = o.months;
  const editable = !!o.onChoose;
  let at = o.focus && keys.includes(o.focus.p) && o.focus.m <= n ? o.focus : { p: keys[0], m: 1 };

  function cell(p, m) {
    const letter = o.plan.cells[p][m - 1];
    const kids = [
      fill(letter, p, p === 'a' && o.plan.maternity.includes(m)),
      el('span', { cls: 'gl', 'aria-hidden': 'true', text: show(letter) }),
      el('span', { cls: 'ga', 'aria-hidden': 'true', text: o.plan.amountTexts[p][m - 1] }),
    ];
    const name = o.plan.cellNames[p][m - 1];
    const own = at.p === p && at.m === m;
    const inner = editable
      ? el('button', { type: 'button', cls: 'gc', 'data-p': p, 'data-m': m, 'aria-label': name, tabindex: own ? 0 : -1 }, ...kids)
      : el('span', { cls: 'gc' }, ...kids, el('span', { cls: 'visually-hidden', text: name }));
    return el('td', {}, inner);
  }
  const th = (scope, text, extra) => el('th', { scope, cls: extra }, text);
  const swatch = (i) => el('span', { cls: `cell c-${i ? 'b' : 'a'}`, 'aria-hidden': 'true' });

  const head = el('tr', {}, th('col', o.life));
  const body = el('tbody');
  if (rows) {
    for (let m = 1; m <= n; m++) head.append(th('col', String(m)));
    keys.forEach((p, i) => {
      const tr = el('tr', {}, el('th', { scope: 'row' }, swatch(i), names[i]));
      for (let m = 1; m <= n; m++) tr.append(cell(p, m));
      body.append(tr);
    });
  } else {
    keys.forEach((p, i) => head.append(el('th', { scope: 'col' }, swatch(i), names[i])));
    for (let m = 1; m <= n; m++) body.append(el('tr', {}, th('row', String(m)), ...keys.map((p) => cell(p, m))));
  }
  // The table is named for itself: in table-navigation mode a reader announces
  // the table, not the region around it, and what it needs to hear is what the
  // table is, not the heading it already read (o.label, from the catalogue).
  // Without a label it falls back to the heading its scroll region carries.
  const table = el(
    'table',
    {
      cls: `plan-grid ${rows ? 'by-parent' : 'by-month'}`,
      'aria-label': o.label,
      'aria-labelledby': o.label ? null : o.labelledby,
    },
    el('thead', {}, head),
    body,
  );
  const scroll = el('div', { cls: 'grid-scroll', role: 'region', tabindex: 0, 'aria-labelledby': o.labelledby }, table);

  // The summary strip (600–1023 px, CSS): the totals and the focused month.
  const month = el('p');
  const strip = el(
    'div',
    { cls: 'grid-strip' },
    el('p', {}, ...keys.map((p) => el('span', { text: o.plan.totals[p].line }))),
    month,
  );
  const showMonth = (m) =>
    month.replaceChildren(
      ...keys.map((p) =>
        el('span', { text: o.plan.details[p][m - 1] ? `${o.plan.cellNames[p][m - 1]} (${o.plan.details[p][m - 1]})` : o.plan.cellNames[p][m - 1] }),
      ),
    );
  showMonth(at.m);
  host.replaceChildren(scroll, strip);

  const find = (p, m) => table.querySelector(`[data-p="${p}"][data-m="${m}"]`);
  if (editable) {
    const move = (p, m) => {
      const b = find(p, m);
      if (!b) return;
      for (const x of table.querySelectorAll('[tabindex="0"]')) x.tabIndex = -1;
      b.tabIndex = 0;
      b.focus();
    };
    table.addEventListener('keydown', (e) => {
      const b = e.target.closest('[data-m]');
      if (!b || e.altKey || e.ctrlKey || e.metaKey) return;
      let pi = keys.indexOf(b.dataset.p);
      let m = +b.dataset.m;
      const d = {
        ArrowRight: rows ? [1, 0] : [0, 1],
        ArrowLeft: rows ? [-1, 0] : [0, -1],
        ArrowDown: rows ? [0, 1] : [1, 0],
        ArrowUp: rows ? [0, -1] : [-1, 0],
      }[e.key];
      if (e.key === 'Home') m = 1;
      else if (e.key === 'End') m = n;
      else if (d) [m, pi] = [m + d[0], pi + d[1]];
      else return;
      e.preventDefault();
      move(keys[Math.min(Math.max(pi, 0), keys.length - 1)], Math.min(Math.max(m, 1), n));
    });
    table.addEventListener('focusin', (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      at = { p: b.dataset.p, m: +b.dataset.m };
      for (const x of table.querySelectorAll('[tabindex="0"]')) if (x !== b) x.tabIndex = -1;
      b.tabIndex = 0;
      showMonth(at.m);
    });
    table.addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (b) o.onChoose(b.dataset.p, +b.dataset.m);
    });
    if (o.refocus) find(at.p, at.m)?.focus();
  }
  return { cell: find };
}

// The chooser for one month of one parent. o: {host, title, current,
// options[{letter, name, text, disabled}], strings{apply, cancel}}.
// Resolves to the chosen letter, or null (Cancel, Escape).
export function choose(o) {
  const radios = o.options.map((x, i) =>
    el(
      'div',
      { cls: 'choice' },
      el('input', { type: 'radio', name: 'gc-kind', id: `gc-kind-${i}`, value: x.letter, checked: x.letter === o.current, disabled: x.disabled, autofocus: x.letter === o.current }),
      el('label', { for: `gc-kind-${i}` }, `${show(x.letter)} · ${x.name}`, x.text ? el('span', { cls: 'opt', text: ` ${x.text}` }) : ''),
    ),
  );
  const form = el(
    'form',
    { method: 'dialog', novalidate: true },
    el('fieldset', { cls: 'q' }, el('legend', { id: 'gc-title', text: o.title }), el('div', { cls: 'choices' }, ...radios)),
    el(
      'div',
      { cls: 'actions' },
      el('button', { cls: 'button', value: 'apply', text: o.strings.apply }),
      el('button', { cls: ['button', 'button-secondary'].join(' '), value: 'cancel', text: o.strings.cancel }),
    ),
  );
  const dialog = el('dialog', { cls: 'calc-chooser', 'aria-labelledby': 'gc-title' }, form);
  o.host.append(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      const picked = dialog.returnValue === 'apply' ? form.querySelector('input:checked')?.value ?? null : null;
      dialog.remove();
      resolve(picked);
    });
    dialog.showModal();
  });
}
