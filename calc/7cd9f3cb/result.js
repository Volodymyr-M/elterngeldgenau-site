// The result screen (migration plan §1.9, §4 P6), loaded with import()
// when the result is shown. It asks core for the ResultView
// (result.analyse), renders it into the frame of partials/calc/result.html
// and sends every change back: a month from the chooser or "use this plan"
// as result.evaluate (debounced 120 ms), the aim as a preferences change
// followed by a new analysis (300 ms). Changes run one after another, each
// on the inputs the one before returned, so none is lost; answers
// overtaken by a newer request are dropped. Every text comes from core or
// from the page ([data-r-s]).

import { STALE, debounce } from './worker-client.js';
import { byParent, choose, el, legend, renderGrid } from './grid.js';

const mounted = new WeakMap();
const wide = matchMedia('(min-width: 1024px)');

export function mount(ctx, section) {
  let screen = mounted.get(section);
  if (!screen) mounted.set(section, (screen = setup(ctx, section)));
  return screen.refresh();
}

function setup(ctx, section) {
  const { client, status, state, root } = ctx;
  const $ = (name) => section.querySelector(`[data-r="${name}"]`);
  const s = {};
  for (const e of section.querySelectorAll('[data-r-s] [data-s]')) s[e.dataset.s] = e.textContent;
  const latest = client.latest('result');
  let view = null;
  let all = false;
  let focus = null;
  let opened = false;
  let chain = Promise.resolve();
  const run = (task) => (chain = chain.then(task).catch(ctx.fail));
  const busy = (on) => {
    root.dataset.result = on ? 'busy' : 'ready';
  };
  // Counts the answers drawn (data-result-drawn; the browser tests wait
  // for the next one after a change, with data-result="ready").
  const drew = () => {
    root.dataset.resultDrawn = String(Number(root.dataset.resultDrawn ?? 0) + 1);
  };

  async function analyse(changed) {
    busy(true);
    if (changed) status.say('computing');
    const r = await latest('result.analyse', { inputs: state.inputs });
    if (r === STALE) return;
    const nc = $('nc');
    nc.hidden = !r.notComputable;
    $('view').hidden = !!r.notComputable;
    if (r.notComputable) {
      nc.querySelector('p').textContent = r.notComputable.message;
      view = null;
    } else {
      view = r.view;
      render(true);
    }
    drew();
    if (changed) status.say('updated');
    busy(false);
  }

  // ---- changes
  const edits = [];
  const evaluate = async (args) => {
    const r = await latest('result.evaluate', { inputs: state.inputs, ...args });
    if (r === STALE) return null;
    state.inputs = r.inputs;
    return r;
  };
  const update = (r) => {
    if (!r || !view) return;
    Object.assign(view, { yours: r.yours, comparison: r.comparison, limit: r.limit, warnings: r.warnings, bestIsYours: r.bestIsYours });
    render(false);
    drew();
    status.say('updated');
  };
  const flush = debounce(
    () =>
      run(async () => {
        busy(true);
        status.say('computing');
        let r = null;
        while (edits.length) r = (await evaluate({ edit: edits.shift() })) ?? r;
        if (!edits.length) update(r);
        busy(false);
      }),
    120,
  );
  const aim = debounce(
    (value) =>
      run(async () => {
        const r = await client.call('screen.apply', {
          inputs: state.inputs,
          screen: 'preferences',
          fields: { 'pref.objective': value },
          action: 'change',
        });
        state.inputs = r.inputs;
        await analyse(true);
      }),
    300,
  );

  async function onChoose(p, m) {
    const prices = view.prices[p][m - 1];
    const current = view.yours.cells[p][m - 1];
    const field = { B: 'basis', P: 'plus', '+': 'bonus' };
    const letter = await choose({
      host: section,
      title: prices.title,
      current,
      strings: s,
      options: view.kinds.map((k) => {
        const f = field[k.letter];
        const text = f ? prices[`${f}Text`] : '';
        return { letter: k.letter, name: k.name, text: text ?? s.not_possible, disabled: f && prices[f] == null };
      }),
    });
    focus = { p, m };
    grids.yours?.cell(p, m)?.focus();
    if (!letter || letter === current) return;
    edits.push({ parent: p, month: m, kind: letter });
    flush();
  }

  $('best').querySelector('button').onclick = () =>
    run(async () => {
      busy(true);
      const r = await evaluate({ plan: view.best.plan });
      update(r);
      if (r) {
        $('used').textContent = s.used_best;
        section.querySelector('#r-cmp').focus();
      }
      busy(false);
    });

  $('yours').addEventListener('focusin', (e) => {
    const b = e.target.closest('[data-m]');
    if (b) focus = { p: b.dataset.p, m: +b.dataset.m };
  });

  const more = $('more');
  more.onclick = () => {
    all = !all;
    renderGrids(false);
  };
  byParent.addEventListener('change', () => view && section.isConnected && renderGrids(false));

  // ---- rendering
  const grids = {};
  function renderGrids(refocus) {
    const months = all ? view.horizon : view.months;
    const inGrid = $('yours').contains(document.activeElement);
    grids.yours = renderGrid($('yours'), {
      view,
      plan: view.yours,
      months,
      labelledby: 'r-grid',
      label: s.grid_name,
      life: s.life_month,
      onChoose,
      focus,
      refocus: refocus || inGrid,
    });
    const best = $('best');
    best.hidden = !view.best || view.bestIsYours;
    if (!best.hidden) {
      renderGrid(best.querySelector('div'), { view, plan: view.best, months, labelledby: 'r-best', life: s.life_month });
    }
    more.hidden = view.months >= view.horizon;
    more.textContent = all ? s.show_fewer : s.show_all;
  }

  const law = (x) => (x.citation ? [' ', el('a', { href: x.url, text: x.citation })] : []);

  function render(full) {
    const v = view;
    const c = v.comparison;
    const parts = [];
    // Above the income limit: no claim, said first (every amount is "below the limit").
    if (c.noClaim) parts.push(el('p', { cls: 'calc-limit' }, el('strong', { text: c.noClaim })));
    if (c.noLawfulPlan) parts.push(el('p', { text: c.noLawfulPlan }));
    else {
      parts.push(el('p', { cls: 'calc-sums' }, el('span', { text: c.yourTotal }), el('span', { text: c.bestTotal })));
      if (c.deltaText) parts.push(el('p', { cls: 'calc-delta', text: c.deltaText }));
      if (c.text) parts.push(el('p', { cls: c.alreadyBest ? 'calc-zero' : null, 'data-zero': c.alreadyBest, text: c.text }));
      if (v.limit) parts.push(el('p', { text: v.limit.intro }), el('p', { cls: 'calc-limit' }, el('strong', { text: v.limit.text }), ...law(v.limit)));
      else if (c.noBetter) parts.push(el('p', { text: c.noBetter }));
    }
    $('compare').replaceChildren(...parts);

    const viol = v.yours.violations;
    $('violations').replaceChildren(
      ...(viol.length ? [el('p', { text: s.plan_invalid }), el('ul', {}, ...viol.map((x) => el('li', { text: x.text }, ...law(x))))] : []),
    );
    $('totals').replaceChildren(
      ...v.parents.map((p) => el('li', { text: v.yours.totals[p.engineId].line })),
      ...(v.yours.totals.household.line ? [el('li', { cls: 'calc-sum', text: v.yours.totals.household.line })] : []),
    );
    const warn = $('warnings');
    warn.hidden = !v.warnings.length;
    warn.querySelector('ul').replaceChildren(
      ...v.warnings.map((w) => el('li', { cls: w.strong ? 'strong' : null, text: w.text }, ...law(w))),
    );
    if (!full) {
      renderGrids(false);
      return;
    }
    $('used').textContent = '';
    const reform = $('reform');
    reform.hidden = !v.draftReform;
    if (v.draftReform) {
      reform.querySelector('h2').textContent = v.draftReform.title;
      reform.querySelector('p').textContent = v.draftReform.body;
    }
    objective();
    legend($('legend'), v);
    renderGrids(false);
    derivation();
  }

  function objective() {
    const box = $('objective');
    const radios = view.objectives.map((o) =>
      el(
        'div',
        { cls: 'choice' },
        el('input', { type: 'radio', name: 'objective', id: `r-obj-${o.value}`, value: o.value, checked: o.value === view.objective }),
        el('label', { for: `r-obj-${o.value}`, text: o.label }),
      ),
    );
    const form = el(
      'form',
      { cls: 'calc-form', novalidate: true },
      el(
        'fieldset',
        { cls: 'q', 'aria-describedby': 'r-obj-h', 'data-calc-enable': true },
        el('legend', { text: s.objective_heading }),
        el('p', { cls: 'hint', id: 'r-obj-h', text: s.objective_note }),
        el('div', { cls: 'choices' }, ...radios),
      ),
    );
    form.addEventListener('change', (e) => aim(e.target.value));
    form.addEventListener('submit', (e) => e.preventDefault());
    box.replaceChildren(form);
  }

  function derivation() {
    const d = $('deriv');
    d.querySelector('div').replaceChildren(
      ...view.derivations.map((x) =>
        el(
          'section',
          {},
          el('h3', { text: x.heading }),
          ...(x.period ? [el('p', { text: x.period }, ...law({ citation: x.periodCitation, url: x.periodUrl }))] : []),
          ...(x.skipped ? [el('p', { cls: 'hint', text: x.skipped })] : []),
          el(
            'table',
            {},
            el(
              'tbody',
              {},
              ...x.rows.map((r) =>
                el(
                  'tr',
                  { cls: [r.emphasis && 'em', r.notCounted && 'off'].filter(Boolean).join(' ') || null },
                  el('th', { scope: 'row' }, r.label, ...law(r), ...(r.note ? [el('span', { cls: 'hint', text: r.note })] : [])),
                  el('td', { text: `${r.sign} ${r.amountText ?? ''}`.trim() }),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    // Open by default on large screens (plan §1.9), once per visit.
    if (!opened) d.open = wide.matches;
    opened = true;
  }

  return {
    refresh() {
      opened = false;
      return run(() => analyse(false));
    },
  };
}
