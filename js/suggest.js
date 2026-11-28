// "Suggest something we missed": the short form at the bottom of the year, state and event panels.
// Loaded only when a reader opens it (main.js imports it on demand); it then loads the Firebase code
// (cloud.js) in the background, so the map's first load never carries any of it.
// No sign-in. The server (geoSuggest) checks everything again; these checks are only for quick feedback.
import { h } from './ui.js';
import { parseYear } from './year.js';

export const TEXT_MIN = 10, TEXT_MAX = 2000;
const MIN_MS = 3200;   // the server refuses forms sent in under 3 s; a fast reader just waits a moment
let seq = 0;

/** A source link: http(s) with a real host, or '' when empty; null when it is not a link. */
export function checkUrl(s) {
  const v = String(s || '').trim();
  if (!v) return '';
  try {
    const u = new URL(v);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || !/\.[a-z]{2,}$/i.test(u.hostname)) return null;
    return u.toString().length <= 500 ? u.toString() : null;
  } catch { return null; }
}
const EMAIL = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)+$/;

/** Problems with the form, as { field: message }. Empty when it can be sent. */
export function problems({ text, sourceUrl, email }) {
  const out = {};
  const t = String(text || '').trim();
  if (t.length < TEXT_MIN) out.text = `Please write at least ${TEXT_MIN} characters about what happened.`;
  else if (t.length > TEXT_MAX) out.text = `Please keep it under ${TEXT_MAX.toLocaleString('en')} characters.`;
  if (checkUrl(sourceUrl) === null) out.sourceUrl = 'This does not look like a web address. It should start with https://';
  const e = String(email || '').trim();
  if (e && !EMAIL.test(e)) out.email = 'This email address does not look right. It is optional: leave it empty if you like.';
  return out;
}

/**
 * Fill `slot` with the form. ctx: { year, dateLabel, subject: { kind, id, name } | null, about }
 * (what the panel shows: "The world in 1776", a state's name or an event's title).
 */
export function mountSuggest(slot, ctx) {
  const n = ++seq;
  const id = (k) => `sg${n}-${k}`;
  const opened = performance.now();
  // start loading Firebase now, while the reader writes
  const cloudP = import('./cloud.js').then((m) => { m.loadCloud().catch(() => {}); return m; });
  cloudP.catch(() => {});

  const field = (k, label, input, hint) => h('div.sg-field', { 'data-f': k },
    h('label', { for: id(k) }, label), hint ? h('p.sg-hint', { id: id(k) + '-h' }, hint) : null, input,
    h('p.sg-err', { id: id(k) + '-e', hidden: true }));
  const text = h('textarea', { id: id('text'), name: 'text', rows: 5, maxlength: TEXT_MAX, required: true, 'aria-describedby': `${id('text')}-c ${id('text')}-e`,
    placeholder: 'What happened, and why it matters here. For example: "The Treaty of Paris, signed on 10 February 1763, ended the Seven Years\' War."' });
  const count = h('p.sg-count', { id: id('text') + '-c', 'aria-live': 'polite' }, `0 / ${TEXT_MAX.toLocaleString('en')}`);
  const place = h('input', { id: id('place'), name: 'place', type: 'text', maxlength: 120, autocomplete: 'off' });
  const date = h('input', { id: id('date'), name: 'date', type: 'text', maxlength: 60, autocomplete: 'off', value: ctx.dateLabel || '' });
  const url = h('input', { id: id('url'), name: 'sourceUrl', type: 'url', inputmode: 'url', maxlength: 500, placeholder: 'https://', autocomplete: 'off', 'aria-describedby': id('url') + '-e' });
  const email = h('input', { id: id('email'), name: 'email', type: 'email', maxlength: 254, autocomplete: 'email', 'aria-describedby': `${id('email')}-h ${id('email')}-e` });
  // the honeypot: hidden from people (and from screen readers), so anything typed into it came from a script
  const hp = h('input', { id: id('hp'), name: 'website', type: 'text', tabindex: '-1', autocomplete: 'off' });
  const status = h('p.sg-status', { role: 'status', 'aria-live': 'polite' });
  const send = h('button.sg-send', { type: 'submit' }, 'Send suggestion');

  const form = h('form.sg-form', { novalidate: true, 'aria-label': 'Suggest something we missed' },
    h('p.sg-about', null, 'About: ', h('b', null, ctx.about)),
    h('div.sg-field', { 'data-f': 'text' }, h('label', { for: id('text') }, 'What happened? ', h('span.sg-req', null, '(required)')), text, count,
      h('p.sg-err', { id: id('text') + '-e', hidden: true })),
    h('div.sg-row', null,
      field('place', h('span', null, 'Place ', h('span.sg-opt', null, '(optional)')), place),
      field('date', h('span', null, 'Date or year ', h('span.sg-opt', null, '(optional)')), date)),
    field('url', h('span', null, 'Source link ', h('span.sg-opt', null, '(optional)')), url),
    field('email', h('span', null, 'Your email, if you would like a reply ', h('span.sg-opt', null, '(optional)')), email,
      'Leave it empty to stay anonymous.'),
    h('div.sg-hp', { 'aria-hidden': 'true' }, h('label', { for: id('hp') }, 'Leave this field empty'), hp),
    h('p.sg-privacy', null, 'We keep what you write here, and your email only if you give one, to check and add the suggestion. ',
      'Your address on the internet is not stored; a scrambled code that changes every day limits how many can be sent. ',
      'Sending loads Google\'s Firebase and reCAPTCHA to keep out spam. ', h('a', { href: 'privacy.html#suggestions' }, 'Privacy policy'), '.'),
    h('div.sg-actions', null, send, status));

  const errs = { text, sourceUrl: url, email };
  const errEl = (k) => form.querySelector(`#${CSS.escape((k === 'sourceUrl' ? id('url') : k === 'email' ? id('email') : id('text')) + '-e')}`);
  function showProblems(p) {
    for (const k of Object.keys(errs)) {
      const el = errEl(k);
      el.hidden = !p[k];
      el.textContent = p[k] || '';
      errs[k].toggleAttribute('aria-invalid', !!p[k]);
    }
  }
  text.addEventListener('input', () => {
    const len = text.value.trim().length;
    count.textContent = `${len.toLocaleString('en')} / ${TEXT_MAX.toLocaleString('en')}`;
    count.classList.toggle('low', len > 0 && len < TEXT_MIN);
  });
  // a message goes away as soon as what it complained about is fixed
  form.addEventListener('input', () => {
    if (!form.querySelector('[aria-invalid]')) return;
    const p = problems(values());
    for (const k of Object.keys(errs)) if (errs[k].hasAttribute('aria-invalid') && !p[k]) { errEl(k).hidden = true; errs[k].removeAttribute('aria-invalid'); }
  });
  const values = () => ({ text: text.value, place: place.value, date: date.value, sourceUrl: url.value, email: email.value });

  let busy = false;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return;
    const v = values();
    const p = problems(v);
    showProblems(p);
    if (Object.keys(p).length) {
      status.textContent = '';
      errs[Object.keys(p)[0]].focus();
      return;
    }
    busy = true;
    send.disabled = true;
    status.className = 'sg-status';
    status.textContent = 'Sending…';
    const typed = parseYear(v.date);
    const payload = {
      text: v.text.trim(), place: v.place.trim(), date: v.date.trim(),
      year: Number.isInteger(typed.year) ? typed.year : ctx.year,
      subject: ctx.subject, sourceUrl: checkUrl(v.sourceUrl) || '', email: v.email.trim(), hp: hp.value,
      ms: Math.round(performance.now() - opened),
    };
    if (payload.ms < MIN_MS) { await new Promise((r) => setTimeout(r, MIN_MS - payload.ms)); payload.ms = Math.round(performance.now() - opened); }
    try {
      const cloud = await cloudP;
      await cloud.sendSuggestion(payload);
      slot.replaceChildren(h('div.sg-done', { role: 'status', tabindex: '-1' },
        h('p.sg-thanks', null, 'Thank you. Your suggestion has been sent.'),
        h('p.note', null, 'It will be read and checked against sources before anything on the map changes.',
          payload.email ? ' If we have a question or add it, we will write to the email you gave.' : ''),
        h('button.more', { type: 'button', onclick: () => mountSuggest(slot, ctx) }, 'Suggest something else')));
      slot.firstChild.focus({ preventScroll: true });
    } catch (e) {
      busy = false;
      send.disabled = false;
      status.className = 'sg-status err';
      status.setAttribute('role', 'alert');
      status.textContent = e?.message && !/import|fetch|module/i.test(e.message) ? e.message : 'The suggestion could not be sent. Check your connection and try again.';
    }
  });
  slot.replaceChildren(form);
  return form;
}
