// A questionnaire form rendered from core's screen state (screen.state,
// screen.apply; packages/web_api/API.md). Core decides which fields show,
// what they hold, how many rows a group has, which options a choice offers
// and the labels that carry names; this module only mirrors that in the
// DOM, reads the raw control values back, and shows errors the GOV.UK way
// (summary with links at the top, message at the field, aria-invalid,
// aria-describedby). Markup contract: generator/lib/calculator.dart.

const defaults = new WeakMap();
const touched = new WeakMap();

const q = (root, sel) => root.querySelector(sel);
const qa = (root, sel) => [...root.querySelectorAll(sel)];

// A row or option from its <template>, `#` replaced by `k` in attributes.
function instantiate(tpl, k) {
  const frag = tpl.content.cloneNode(true);
  for (const el of frag.querySelectorAll('*')) {
    for (const a of el.attributes) if (a.value.includes('#')) a.value = a.value.replaceAll('#', k);
  }
  return frag;
}

function setRows(box, n) {
  const tpl = q(box, ':scope > template');
  const rows = qa(box, ':scope > [data-row]');
  for (let k = rows.length; k < n; k++) box.append(instantiate(tpl, String(k)));
  for (let k = rows.length - 1; k >= n; k--) rows[k].remove();
}

function setOptions(box, values) {
  const have = qa(box, 'input').map((i) => i.value);
  if (have.join() === values.join()) return;
  for (const c of qa(box, ':scope > .choice')) c.remove();
  const tpl = q(box, ':scope > template');
  for (const v of values) box.append(instantiate(tpl, v));
}

// The element a label key of core's `labels` names.
function labelTarget(form, key) {
  const own = q(form, `[data-label="${key}"]`);
  if (own) return own;
  if (key.startsWith('remove:')) return q(form, `[data-action="${key}"]`);
  const eq = key.indexOf('=');
  if (eq > 0) {
    const input = q(form, `input[name="${key.slice(0, eq)}"][value="${key.slice(eq + 1)}"]`);
    return input && q(form, `label[for="${input.id}"]`);
  }
  if (key.endsWith('#help')) return q(form, `[data-field="${key.slice(0, -5)}"] .hint`);
  const field = q(form, `[data-field="${key}"]`);
  return field && q(field, 'legend > span, label > span');
}

function applyLabels(form, labels) {
  const now = new Set();
  for (const [key, text] of Object.entries(labels)) {
    const el = labelTarget(form, key);
    if (!el) continue;
    if (!defaults.has(el)) defaults.set(el, el.textContent);
    el.textContent = text;
    if (el.hasAttribute('data-label-hide')) el.hidden = false;
    now.add(el);
  }
  for (const el of touched.get(form) ?? []) {
    if (now.has(el) || !el.isConnected) continue;
    el.textContent = defaults.get(el);
    if (el.hasAttribute('data-label-hide')) el.hidden = true;
  }
  touched.set(form, now);
}

function setValue(form, name, value, keepFocused) {
  for (const el of qa(form, `[name="${name}"]`)) {
    if (el.type === 'radio') el.checked = el.value === value;
    else if (el.type === 'checkbox') el.checked = value === 'true';
    else if (!(keepFocused && el === document.activeElement) && el.value !== value) el.value = value;
  }
}

// Mirrors a screen state in `form`. keepFocused: leave the text of the
// control being typed in alone (answers to `change`).
export function render(form, st, keepFocused = false) {
  const visible = new Set(st.visible);
  const options = st.options ?? {};
  for (const box of qa(form, '[data-repeat]')) setRows(box, st.repeats[box.dataset.repeat] ?? 0);
  for (const box of qa(form, '[data-options]')) setOptions(box, options[box.dataset.options] ?? []);
  for (const el of qa(form, '[data-field]')) el.hidden = !visible.has(el.dataset.field);
  for (const [name, values] of Object.entries(options)) {
    for (const i of qa(form, `input[name="${name}"]`)) i.closest('.choice').hidden = !values.includes(i.value);
  }
  for (const b of qa(form, '[data-action^="add:"]')) b.hidden = !(b.dataset.action.slice(4) in st.repeats);
  applyLabels(form, st.labels);
  for (const [name, value] of Object.entries(st.values)) setValue(form, name, value, keepFocused);
  for (const el of qa(form, '[data-when]')) {
    const [name, value] = el.dataset.when.split('=');
    el.hidden = st.values[name] !== value;
  }
  // Groups (a parent's section, a numbered question) show while any of
  // their fields does; inner groups first.
  const groups = qa(form, '[data-calc-group]');
  for (const g of groups) g.hidden = false;
  for (const g of groups.reverse()) g.hidden = !qa(g, '[data-field]').some((f) => !f.closest('[hidden]'));
  const submit = q(form, 'button[type="submit"]');
  if (submit) submit.disabled = st.canSubmit === false;
}

// The raw strings of every shown control: text as typed, a checkbox
// "true" or "", a radio group its value or "".
export function collect(form) {
  const out = {};
  for (const el of qa(form, 'input[name],select[name],textarea[name]')) {
    if (el.closest('[hidden]')) continue;
    if (el.type === 'radio') {
      if (!(el.name in out)) out[el.name] = '';
      if (el.checked) out[el.name] = el.value;
    } else if (el.type === 'checkbox') {
      out[el.name] = el.checked ? 'true' : '';
    } else {
      out[el.name] = el.value;
    }
  }
  return out;
}

function describedBy(el, id, add) {
  const ids = (el.getAttribute('aria-describedby') ?? '').split(' ').filter((x) => x && x !== id);
  if (add) ids.push(id);
  if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
  else el.removeAttribute('aria-describedby');
}

export function clearErrors(form) {
  for (const p of qa(form, '[data-error]')) {
    for (const c of qa(form, `[aria-describedby~="${p.id}"]`)) describedBy(c, p.id, false);
    p.remove();
  }
  for (const c of qa(form, '[aria-invalid]')) c.removeAttribute('aria-invalid');
  const box = q(form, '[data-calc-errors]');
  box.hidden = true;
  q(box, '[data-calc-error-list]').replaceChildren();
}

// Errors [{field, message}] at their fields and in the summary, which
// takes focus (role="alert" announces it).
export function showErrors(form, errors, summary) {
  clearErrors(form);
  const box = q(form, '[data-calc-errors]');
  const list = q(box, '[data-calc-error-list]');
  q(box, '[data-calc-summary]').textContent = summary ?? '';
  for (const { field, message } of errors) {
    const wrap = q(form, `[data-field="${field}"]`);
    const named = qa(form, `[name="${field}"]`);
    const first = named[0] ?? (wrap && q(wrap, 'input,select,button'));
    if (wrap) {
      const p = document.createElement('p');
      p.className = 'field-error';
      p.id = `${first?.id ?? field}-e`;
      p.dataset.error = field;
      p.textContent = message;
      const at = q(wrap, ':scope > .input-row, :scope > .choices, :scope > .choice, :scope > select, :scope > div');
      if (at) at.before(p);
      else wrap.prepend(p);
      for (const c of named.length ? named : [wrap]) {
        if (named.length) c.setAttribute('aria-invalid', 'true');
        describedBy(c, p.id, true);
      }
    }
    const a = document.createElement('a');
    a.href = `#${first?.id ?? ''}`;
    a.dataset.focus = first?.id ?? '';
    // The question the message belongs to, as the page shows it.
    const question = wrap && q(wrap, 'legend > span, label > span, legend');
    if (question?.textContent) {
      const s = document.createElement('span');
      s.className = 'error-q';
      s.textContent = question.textContent;
      a.append(s);
    }
    a.append(message);
    const li = document.createElement('li');
    li.append(a);
    list.append(li);
  }
  box.hidden = false;
  box.focus();
}
