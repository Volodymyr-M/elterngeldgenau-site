// The paper-form extra on the details screen (/antrag/angaben; migration
// plan §4 P7), loaded with import() there: what core's forms.plan says for
// the household, a card per official file with core's verdict on the file
// picked (forms.check; the worker keeps an accepted one), and the sample
// or, after the order, the form itself (paid.applicationForm) as a Blob
// download. Every text comes from core or from the page.

import { clearErrors, collect, render, showErrors } from './form.js';
import { PDF, drawn, follow, once, q, save, say, watch } from './paid.js';

export function mount(ctx, section) {
  watch(ctx.state);
  const root = section.querySelector('[data-paid="details"]');
  if (root && once(root, 'mounted')) return details(ctx, root);
}

async function details(ctx, root) {
  const { client, state } = ctx;
  const form = root.querySelector('form');
  const list = q(root, 'file-list');
  const card = q(root, 'file');
  let paid = false;

  function files(downloads) {
    const keep = new Set(downloads.map((d) => d.key));
    for (const c of [...list.children]) if (!keep.has(c.dataset.key)) c.remove();
    downloads.forEach((d, i) => {
      let c = [...list.children].find((x) => x.dataset.key === d.key);
      if (!c) {
        c = card.content.firstElementChild.cloneNode(true);
        c.dataset.key = d.key;
        const input = c.querySelector('[data-f="pick"]');
        input.id = `d-file-${i}-${d.key.replace(/\W/g, '-')}`;
        c.querySelector('[data-f="pick-label"]').htmlFor = input.id;
        input.addEventListener('change', () => pick(c, input));
        input.closest('fieldset').disabled = false;
        list.append(c);
      }
      c.querySelector('[data-f="step1"]').textContent = d.step1;
      c.querySelector('[data-f="label"]').textContent = d.label;
      c.querySelector('[data-f="page"]').href = d.pageUrl;
      c.querySelector('[data-f="direct"]').href = d.fileUrl;
      c.dataset.accepted = d.accepted;
      if (d.message) c.querySelector('[data-f="verdict"]').textContent = d.message;
    });
  }

  async function pick(c, input) {
    const file = input.files[0];
    if (!file) return;
    const verdict = c.querySelector('[data-f="verdict"]');
    c.dataset.accepted = '';
    say(ctx, verdict, 'file_checking');
    try {
      const r = await client.call('forms.check', { key: c.dataset.key }, await file.arrayBuffer());
      c.dataset.accepted = r.accepted;
      verdict.textContent = r.message;
    } catch (e) {
      say(ctx, verdict, 'failed', e);
    }
  }

  async function refresh() {
    const f = await client.call('forms.plan', { inputs: state.inputs });
    for (const k of ['noState', 'unsupported', 'incomplete', 'supported']) q(root, k).hidden = f.status !== k;
    if (f.unsupported) {
      q(root, 'u-head').textContent = f.unsupported.headline;
      q(root, 'u-link').textContent = f.unsupported.link;
      q(root, 'u-link').href = f.unsupported.url;
    }
    const supported = f.status === 'supported';
    if (supported) {
      q(root, 'state-line').textContent = f.stateLine;
      q(root, 'plan-invalid').textContent = f.planInvalid ?? '';
      q(root, 'plan-invalid').hidden = !f.planInvalid;
      files(f.downloads);
    }
    q(root, 'files').hidden = !supported;
    q(root, 'make').hidden = !supported;
    root.querySelector('[data-make="final"]').hidden = !paid;
    q(root, 'to-checkout').hidden = paid;
  }

  paid = (await client.call('checkout.status')).paid;
  await follow(root, refresh);
  drawn(root);

  root.addEventListener(
    'submit',
    async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sample = e.submitter?.dataset.make !== 'final';
      const line = q(root, 'status');
      const issues = q(root, 'issues');
      issues.hidden = true;
      q(root, 'checklist').hidden = true;
      try {
        const r = await client.call('screen.apply', { inputs: state.inputs, screen: 'details', fields: collect(form), action: 'submit' });
        state.inputs = r.inputs;
        render(form, r, true);
        if (r.errors.length) return showErrors(form, r.errors, r.summary);
        clearErrors(form);
        say(ctx, line, sample ? 'sample_working' : 'form_working');
        const out = await client.call('paid.applicationForm', { inputs: state.inputs, sample });
        if (!out.bytes) {
          line.textContent = out.message;
          const ul = issues.querySelector('ul');
          ul.replaceChildren(...out.issues.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
          issues.hidden = !out.issues.length;
          return;
        }
        save(out.bytes, out.filename, PDF);
        say(ctx, line, sample ? 'sample_done' : 'form_done');
        if (!sample && out.checklist) checklist(out.checklist);
      } catch (err) {
        say(ctx, line, 'failed', err);
      }
    },
    true,
  );

  function checklist(sections) {
    const body = q(root, 'checklist-body');
    body.replaceChildren();
    for (const s of sections) {
      const h = document.createElement('h3');
      h.textContent = s.heading;
      body.append(h);
      if (s.intro) body.append(Object.assign(document.createElement('p'), { textContent: s.intro }));
      const ul = document.createElement('ul');
      ul.append(...s.items.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
      body.append(ul);
    }
    q(root, 'checklist').hidden = false;
  }
}
