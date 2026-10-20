'use strict';
document.documentElement.lang = 'he'; document.documentElement.dir = 'rtl';
/* יועץ עסקי. ללא הגדרת Firebase הנתונים נשמרים ב-localStorage; עם הגדרה (cloud.js) יש התחברות, שמירה בענן ושוק משותף. */
const Cloud = window.Cloud || { enabled: false };
let me = null; // המשתמש המחובר (מצב ענן)
let M = []; // בקשות השוק המשותף (מצב ענן)
let loading = Cloud.enabled;
let isAdmin = false; // מנהל (admins/{uid} ב-Firestore): רואה את כל סביבות העבודה, לקריאה בלבד
let adminData = null; let adminUser = null;

const KEY = 'consulting-suite-v1';
const $ = (s) => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toISOString().slice(0, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '₪' + Math.round(n || 0).toLocaleString('he-IL');
const num = (v) => (isFinite(parseFloat(v)) ? parseFloat(v) : 0);

const empty = () => ({
  clients: [], projects: [], tasks: [], time: [], invoices: [],
  diagnostics: [], profiles: [], requests: [],
  plan: { cash: 50000, revenue: 30000, growth: 3, cogs: 35, fixed: 18000, months: 12 },
  settings: { rate: 400 },
});
let S;
const readLocal = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
S = Cloud.enabled ? empty() : Object.assign(empty(), readLocal() || {});
const PEND = 'consulting-suite-unsynced-'; // עותק מקומי של שינויים שעוד לא אושרו בענן; נמחק כשהשמירה מצליחה
const readPend = (uid) => { try { return JSON.parse(localStorage.getItem(PEND + uid) || 'null'); } catch { return null; } };
const privateState = () => { const { requests, ...rest } = S; return rest; };
let saveStatus = { st: '', err: '' }; // saving | saved | error
const SV_TEXT = { saving: 'שומר…', saved: 'נשמר ✓', error: 'שגיאת שמירה' };
const setSaveState = (st, err) => {
  saveStatus = { st, err: err || '' };
  if (st === 'saved' && me && !Cloud.hasPending()) { try { localStorage.removeItem(PEND + me.uid); } catch { /* ignore */ } }
  const el = $('#sv'); if (el) { el.textContent = SV_TEXT[st] || ''; el.title = err || ''; el.style.color = st === 'error' ? 'var(--bad)' : ''; }
  let b = $('#sb'); // באנר בולט כשהשמירה נכשלת, כדי שלא יאבדו שינויים בלי שהמשתמש יודע
  if (st === 'error') {
    if (!b) { b = document.createElement('div'); b.id = 'sb'; b.className = 'savebanner'; b.setAttribute('role', 'alert'); document.body.prepend(b); }
    b.innerHTML = `<span>השינויים האחרונים עדיין לא נשמרו בענן. ${esc(err || '')} האתר ממשיך לנסות אוטומטית.</span> <button data-do="saveRetry">נסה עכשיו</button>`;
  } else b?.remove();
};
addEventListener('beforeunload', (e) => { if (Cloud.enabled && (saveStatus.st === 'saving' || saveStatus.st === 'error')) { e.preventDefault(); e.returnValue = ''; } });
const save = () => {
  if (Cloud.enabled) {
    if (!me) return;
    try { localStorage.setItem(PEND + me.uid, JSON.stringify({ ts: Date.now(), data: privateState() })); } catch { /* מכסה מלאה או חסום */ }
    Cloud.queueSave(me.uid, privateState(), setSaveState); return;
  }
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* storage blocked */ }
};
const by = (list, id) => list.find((x) => x.id === id);
const clientName = (id) => by(S.clients, id)?.name || '—';
const projectName = (id) => by(S.projects, id)?.name || '—';


/* ---------- דיאלוגים בתוך הדף (confirm/alert/הורדה לא זמינים בכל סביבה) ---------- */
function show(html, onMount) {
  const dlg = $('#dlg'); dlg.innerHTML = html; dlg.showModal(); onMount?.(dlg);
}
function ask(msg, onYes) {
  show(`<form method="dialog"><p>${esc(msg)}</p><div class="row"><button class="pri" value="ok">אישור</button><button value="cancel">ביטול</button></div></form>`,
    (d) => { d.querySelector('form').onsubmit = (ev) => { if (ev.submitter?.value === 'ok') onYes(); }; });
}
function note(msg) { show(`<form method="dialog"><p>${esc(msg)}</p><div class="row"><button class="pri">הבנתי</button></div></form>`); }
function textBox(title, text, hint) {
  show(`<form method="dialog"><h2>${esc(title)}</h2><p class="muted">${esc(hint)}</p><textarea id="tb" readonly style="min-height:200px;direction:ltr;font-family:monospace;font-size:12px">${esc(text)}</textarea>
  <div class="row"><button type="button" id="cp" class="pri">העתקה</button><button>סגירה</button></div></form>`, (d) => {
    const ta = d.querySelector('#tb');
    d.querySelector('#cp').onclick = () => { ta.select(); (navigator.clipboard?.writeText(text) || Promise.reject()).catch(() => document.execCommand?.('copy')); };
  });
}

/* ---------- טפסים (dialog) ---------- */
function form(title, fields, values, onSave) {
  const dlg = $('#dlg');
  dlg.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2>${fields.map((f) => {
    const v = values?.[f.k] ?? f.def ?? '';
    let input;
    if (f.type === 'select') input = `<select name="${f.k}">${f.opts.map(([val, lab]) => `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
    else if (f.type === 'textarea') input = `<textarea name="${f.k}">${esc(v)}</textarea>`;
    else input = `<input name="${f.k}" type="${f.type || 'text'}" value="${esc(v)}" ${f.type === 'number' ? 'step="any"' : ''}>`;
    return `<label>${esc(f.label)}</label>${input}`;
  }).join('')}<div class="row"><button class="pri" value="ok">שמירה</button><button value="cancel" formnovalidate>ביטול</button></div></form>`;
  dlg.querySelector('form').onsubmit = (ev) => {
    if (ev.submitter?.value !== 'ok') return;
    const fd = new FormData(ev.target);
    const out = {};
    fields.forEach((f) => { const raw = fd.get(f.k); out[f.k] = f.type === 'number' ? num(raw) : String(raw ?? '').trim(); });
    onSave(out);
    save(); render();
  };
  dlg.showModal();
}
const clientOpts = () => [['', '— ללא —'], ...S.clients.map((c) => [c.id, c.name])];
const projectOpts = () => S.projects.map((p) => [p.id, p.name]);

/* ---------- ראוטר ---------- */
const VIEWS = {
  dashboard: ['לוח בקרה', dashboard],
  clients: ['לקוחות ופרויקטים', clients],
  tasks: ['משימות', tasks],
  finance: ['שעות וחשבוניות', finance],
  diagnostic: ['אבחון עסקי', diagnostic],
  profile: ['אפיון אישי', profileView],
  plan: ['תוכנית ותחזית', plan],
  market: ['שוק ייעוץ', market],
};
function render() {
  if (Cloud.enabled && (loading || !me)) {
    tourClear(); // אם התנתקו באמצע ההדרכה, לא משאירים את החלון מעל מסך הכניסה
    $('#nav').innerHTML = '';
    $('#view').innerHTML = loading ? '<div class="empty">טוען…</div>' : loginView();
    return;
  }
  const id = (location.hash || '#dashboard').slice(1);
  const V = isAdmin ? { ...VIEWS, admin: ['ניהול', adminView] } : VIEWS;
  const [, fn] = V[id] || V.dashboard;
  const help = '<button class="sm" data-do="tourStart">הדרכה</button>';
  const who = `<span class="who">${Cloud.enabled ? `${esc(me.label)} · <small id="sv" ${saveStatus.st === 'error' ? 'style="color:var(--bad)"' : ''}>${SV_TEXT[saveStatus.st] || ''}</small> ` : ''}${help}${Cloud.enabled ? ' <button class="sm" data-do="logout">יציאה</button>' : ''}</span>`;
  $('#nav').innerHTML = Object.entries(V).map(([k, [t]]) => `<a href="#${k}" class="${k === id ? 'on' : ''}">${t}</a>`).join('') + who;
  $('#view').innerHTML = fn();
  tourRender();
}
const EYE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
function loginView() {
  return `<div class="card login"><h1>כניסה למערכת</h1>
  <form id="lf"><label for="em">מייל או שם משתמש</label><input id="em" type="text" dir="ltr" autocomplete="username" autocapitalize="none" spellcheck="false" required>
  <label for="pw">סיסמה</label>
  <div class="pwrap"><input id="pw" type="password" dir="ltr" autocomplete="current-password" autocapitalize="none" minlength="6">
  <button type="button" class="eye" data-do="togglePw" aria-label="הצג סיסמה" aria-pressed="false" title="הצג סיסמה">${EYE}</button></div>
  <p id="lerr" class="err" role="alert"></p>
  <div class="row"><button class="pri">כניסה</button><button type="button" data-do="signup">הרשמה</button><button type="button" data-do="forgot">שכחתי סיסמה</button></div></form>
  <div class="row"><button type="button" data-do="googleIn">כניסה עם Google</button></div></div>`;
}
const authMsg = (t, ok) => { const e = $('#lerr'); if (e) { e.textContent = t; e.style.color = ok ? 'var(--ok)' : 'var(--bad)'; } };
const creds = () => [($('#em')?.value || '').trim(), $('#pw')?.value || ''];
document.addEventListener('submit', async (ev) => {
  if (ev.target.id !== 'lf') return;
  ev.preventDefault();
  const [em, pw] = creds(); const r = await Cloud.signIn(em, pw);
  if (!r.ok) authMsg(r.error);
});
addEventListener('hashchange', render);
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-do]');
  if (b) ACTIONS[b.dataset.do]?.(b.dataset.id, b.dataset);
});

/* ---------- לוח בקרה ---------- */
function dashboard() {
  const unbilled = S.time.filter((t) => !t.invoice).reduce((a, t) => a + t.hours * t.rate, 0);
  const open = S.invoices.filter((i) => !i.paid).reduce((a, i) => a + i.total, 0);
  const paid = S.invoices.filter((i) => i.paid).reduce((a, i) => a + i.total, 0);
  const due = openTasks().slice(0, 6);
  return `<h1>לוח בקרה</h1><div class="grid">
    ${stat(S.clients.length, 'לקוחות')}${stat(S.projects.filter((p) => p.status === 'פעיל').length, 'פרויקטים פעילים')}
    ${stat(money(unbilled), 'שעות שטרם חויבו')}${stat(money(open), 'חשבוניות פתוחות')}${stat(money(paid), 'הכנסות ששולמו')}
  </div><div class="card" style="margin-top:16px"><h2>משימות בעדיפות עליונה</h2>${due.length ? `<table>${due.map((t) => `<tr><td>${esc(t.title)}${subProg(t).all ? ` <span class="tag">${subProg(t).done}/${subProg(t).all}</span>` : ''}</td><td class="muted">${esc(projectName(t.project))}</td><td>${esc(t.due || '')}</td></tr>`).join('')}</table>` : '<div class="empty">אין משימות פתוחות</div>'}</div>
  <div class="card no-print"><h2>גיבוי נתונים</h2><p class="muted">${Cloud.enabled ? 'הנתונים נשמרים בחשבון שלך בענן ומסונכרנים בין מכשירים. גיבוי JSON הוא אופציונלי.' : 'הנתונים נשמרים בדפדפן הזה בלבד. מומלץ לייצא גיבוי מדי פעם.'}</p>
  <button data-do="export">ייצוא JSON</button> <button data-do="import">ייבוא JSON</button> <button class="del" data-do="reset">איפוס הכול</button></div>`;
}
const stat = (v, l) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`;

/* ---------- לקוחות ופרויקטים ---------- */
function clients() {
  return `<h1>לקוחות ופרויקטים</h1>
  <div class="card"><div class="bar"><h2>לקוחות</h2><button class="pri" data-do="clientNew">+ לקוח</button></div>
  ${S.clients.length ? `<div class="scroll"><table><tr><th>שם</th><th>איש קשר</th><th>טלפון / מייל</th><th>תחום</th><th></th></tr>${S.clients.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.contact)}</td><td>${esc(c.phone)} ${esc(c.email)}</td><td>${esc(c.industry)}</td><td>${edit('client', c.id)}</td></tr>`).join('')}</table></div>` : '<div class="empty">עדיין אין לקוחות</div>'}</div>
  <div class="card"><div class="bar"><h2>פרויקטים</h2><button class="pri" data-do="projectNew">+ פרויקט</button></div>
  ${S.projects.length ? `<div class="scroll"><table><tr><th>פרויקט</th><th>לקוח</th><th>סטטוס</th><th>תקציב</th><th>שעות</th><th></th></tr>${S.projects.map((p) => {
    const h = S.time.filter((t) => t.project === p.id).reduce((a, t) => a + t.hours, 0);
    return `<tr><td>${esc(p.name)}</td><td>${esc(clientName(p.client))}</td><td><span class="tag ${p.status === 'פעיל' ? 'ok' : ''}">${esc(p.status)}</span></td><td>${money(p.budget)}</td><td>${h}</td><td>${edit('project', p.id)}</td></tr>`;
  }).join('')}</table></div>` : '<div class="empty">עדיין אין פרויקטים</div>'}</div>`;
}
const edit = (kind, id) => `<button class="sm" data-do="${kind}Edit" data-id="${id}">עריכה</button> <button class="sm del" data-do="${kind}Del" data-id="${id}">מחיקה</button>`;
const CLIENT_F = () => [{ k: 'name', label: 'שם הלקוח / העסק' }, { k: 'contact', label: 'איש קשר' }, { k: 'phone', label: 'טלפון' }, { k: 'email', label: 'מייל', type: 'email' }, { k: 'industry', label: 'תחום פעילות' }, { k: 'notes', label: 'הערות', type: 'textarea' }];
const PROJECT_F = () => [{ k: 'name', label: 'שם הפרויקט' }, { k: 'client', label: 'לקוח', type: 'select', opts: clientOpts() }, { k: 'status', label: 'סטטוס', type: 'select', opts: ['פעיל', 'בהמתנה', 'הושלם'].map((x) => [x, x]) }, { k: 'budget', label: 'תקציב (₪)', type: 'number' }];

/* ---------- משימות ---------- */
/* סדר המשימות במערך S.tasks הוא סדר העדיפות: למעלה = הכי דחוף. המשימות שהושלמו יורדות לסוף.
   לכל משימה יש t.subs: תתי-משימות {id,title,due,done}, גם הן לפי סדר עדיפות. */
const openTasks = () => S.tasks.filter((t) => !t.done);
const collapsed = new Set(); // משימות שתתי-המשימות שלהן מקופלות (מצב תצוגה בלבד)
const subProg = (t) => { const s = t.subs || []; return { done: s.filter((x) => x.done).length, all: s.length }; };
/* תאריך יעד: באדום אם עבר, בכתום אם אחרי תאריך היעד של המשימה הראשית */
const dueTag = (due, done, parentDue) => {
  if (!due) return '';
  if (!done && due < today()) return `<span class="tag bad" title="עבר מועד היעד">${esc(due)}</span>`;
  if (!done && parentDue && due > parentDue) return `<span class="tag warn" title="אחרי תאריך היעד של המשימה (${esc(parentDue)})">${esc(due)}</span>`;
  return esc(due);
};
function subTable(t) {
  const subs = t.subs || []; const open = subs.filter((x) => !x.done); const done = subs.filter((x) => x.done);
  const btn = (act, x, label, text) => `<button class="sm" data-do="${act}" data-id="${t.id}" data-sid="${x.id}" aria-label="${label}" title="${label}">${text}</button>`;
  const row = (x) => `<tr data-sub="${x.id}" ${x.done ? '' : 'data-open'}>
    <td class="handle" ${x.done ? '' : 'data-handle="sub" title="גרור כדי לתעדף" aria-hidden="true"'}>${x.done ? '' : '⠿'}</td>
    <td style="width:30px"><input type="checkbox" aria-label="סמן תת-משימה כהושלמה" ${x.done ? 'checked' : ''} data-do="subToggle" data-id="${t.id}" data-sid="${x.id}"></td>
    <td style="${x.done ? 'text-decoration:line-through;color:var(--mut)' : ''}">${esc(x.title)}</td>
    <td>${dueTag(x.due, x.done, t.due)}</td>
    <td class="nowrap">${btn('subEdit', x, 'עריכה', 'עריכה')} <button class="sm del" data-do="subDel" data-id="${t.id}" data-sid="${x.id}">מחיקה</button></td></tr>`;
  return `<table class="subtable"><tbody data-subs="${t.id}">${open.map(row).join('')}${done.map(row).join('')}</tbody></table>
    <div class="row subbar"><button class="sm" data-do="subNew" data-id="${t.id}">+ תת-משימה</button>${open.length > 1 ? `<button class="sm" data-do="subSort" data-id="${t.id}" title="סדר מחדש לפי תאריך יעד">מיין לפי תאריך</button>` : ''}</div>`;
}
function tasks() {
  const open = openTasks(); const done = S.tasks.filter((t) => t.done);
  const block = (t, rank) => {
    const p = subProg(t); const fold = collapsed.has(t.id);
    return `<tbody data-task="${t.id}" ${t.done ? '' : 'data-open'}><tr class="trow">
    <td class="handle" ${t.done ? '' : 'data-handle="task" title="גרור כדי לשנות עדיפות" aria-hidden="true"'}>${t.done ? '' : '⠿'}</td>
    <td class="rank">${t.done ? '' : '#' + rank}</td>
    <td style="width:30px"><input type="checkbox" aria-label="סמן כהושלמה" ${t.done ? 'checked' : ''} data-do="taskToggle" data-id="${t.id}"></td>
    <td style="${t.done ? 'text-decoration:line-through;color:var(--mut)' : ''}">${p.all && !t.done ? `<button class="fold" data-do="taskFold" data-id="${t.id}" aria-expanded="${!fold}" aria-label="${fold ? 'הצג' : 'הסתר'} תתי-משימות">${fold ? '▸' : '▾'}</button> ` : ''}${esc(t.title)}${p.all ? ` <span class="tag ${p.done === p.all ? 'ok' : ''}" title="תתי-משימות שהושלמו">${p.done}/${p.all}</span>` : ''}</td>
    <td class="muted">${esc(projectName(t.project))}</td>
    <td>${dueTag(t.due, t.done)}</td>
    <td class="nowrap">${t.done ? '' : `<button class="sm" data-do="subNew" data-id="${t.id}" title="הוסף תת-משימה">+ תת</button> `}${edit('task', t.id)}</td></tr>
    ${!t.done && p.all && !fold ? `<tr class="subrow"><td></td><td></td><td colspan="5">${subTable(t)}</td></tr>` : ''}</tbody>`;
  };
  return `<h1>משימות</h1><div class="card"><div class="bar"><span class="muted">${open.length} פתוחות · גרור את ⠿ כדי לתעדף, הדחופה ביותר למעלה</span>
  <span><select id="tsort" aria-label="מיין את המשימות הפתוחות" title="הסדר החדש נשמר כסדר העדיפות, ואפשר להמשיך לגרור" style="width:auto">
    <option value="" selected disabled>מיין לפי…</option>
    <option value="due-asc">תאריך יעד: הקרוב ראשון</option><option value="due-desc">תאריך יעד: הרחוק ראשון</option>
    <option value="project">פרויקט</option><option value="title">שם המשימה (א-ת)</option>
    <option value="newest">נוספו לאחרונה</option><option value="oldest">הוותיקות ראשונות</option>
    <option value="subs-open">הכי הרבה תתי-משימות פתוחות</option><option value="progress">הכי קרובות להשלמה</option>
  </select> <button class="pri" data-do="taskNew">+ משימה</button></span></div>
  ${S.tasks.length ? `<div class="scroll"><table id="tl">${open.map((t, i) => block(t, i + 1)).join('')}${done.map((t) => block(t)).join('')}</table></div>` : '<div class="empty">אין משימות</div>'}</div>`;
}
/* גרירה בעכבר ובמגע (pointer events): משימות ראשיות, ותתי-משימות בתוך המשימה שלהן */
let drag = null;
const dragRect = (el) => (el.matches('tbody') ? el.rows[0] : el).getBoundingClientRect(); // tbody: מודדים לפי השורה הראשונה
function dragActivate() {
  drag.active = true; drag.item.classList.add('dragging'); document.body.classList.add('dragging-now');
  if (drag.kind === 'task') drag.box.classList.add('drag-tasks'); // בזמן גרירה מקפלים את תתי-המשימות
  getSelection()?.removeAllRanges();
  try { drag.h.setPointerCapture(drag.id); } catch { /* ממשיכים גם בלי לכידה */ }
}
document.addEventListener('pointerdown', (ev) => {
  if (ev.button > 0) return;
  let h = ev.target.closest('[data-handle]'); let now = true;
  if (!h) { // בעכבר אפשר לגרור מכל מקום בשורה, חוץ מכפתורים ושדות; במגע רק מהידית (כדי לא לחסום גלילה)
    if (ev.pointerType !== 'mouse' || ev.target.closest('button, input, select, textarea, a')) return;
    h = ev.target.closest('tr.trow, tr[data-sub]')?.querySelector('[data-handle]'); now = false;
    if (!h) return;
  }
  const kind = h.dataset.handle; const item = h.closest(kind === 'task' ? 'tbody[data-open]' : 'tr[data-sub]'); if (!item) return;
  drag = { kind, item, h, box: item.parentElement, id: ev.pointerId, x: ev.clientX, y: ev.clientY, active: false };
  if (now) { ev.preventDefault(); dragActivate(); }
});
document.addEventListener('pointermove', (ev) => {
  if (!drag || ev.pointerId !== drag.id) return;
  if (!drag.active) { if (Math.abs(ev.clientY - drag.y) + Math.abs(ev.clientX - drag.x) < 5) return; dragActivate(); } // סף קטן: לחיצה רגילה לא נחשבת גרירה
  const sibs = [...drag.box.children].filter((el) => el.hasAttribute('data-open') && el !== drag.item);
  const before = sibs.find((r) => { const b = dragRect(r); return ev.clientY < b.top + b.height / 2; });
  if (before) drag.box.insertBefore(drag.item, before); else if (sibs.length) sibs[sibs.length - 1].after(drag.item);
  if (ev.clientY < 70) scrollBy(0, -14); else if (ev.clientY > innerHeight - 70) scrollBy(0, 14);
});
const endDrag = (ev) => {
  if (!drag || ev.pointerId !== drag.id) return;
  const { kind, item, box, active } = drag; drag = null;
  if (!active) return; // רק לחיצה
  item.classList.remove('dragging'); box.classList.remove('drag-tasks'); document.body.classList.remove('dragging-now');
  const ids = [...box.children].filter((el) => el.hasAttribute('data-open')).map((el) => el.dataset.task || el.dataset.sub);
  if (kind === 'task') setTasksOrder(ids); else setSubsOrder(box.dataset.subs, ids);
};
document.addEventListener('pointerup', endDrag); document.addEventListener('pointercancel', endDrag);
/* מיון המשימות הפתוחות: הסדר החדש נשמר כסדר העדיפות (אפשר להמשיך לגרור). ריקים (בלי תאריך/פרויקט) תמיד בסוף. */
const cmpEmptyLast = (x, y, f) => (x ? (y ? f(x, y) : -1) : (y ? 1 : 0));
const cmpDue = (a, b, dir) => cmpEmptyLast(a.due, b.due, (x, y) => dir * x.localeCompare(y));
const openSubs = (t) => (t.subs || []).filter((s) => !s.done).length;
const doneRatio = (t) => { const p = subProg(t); return p.all ? p.done / p.all : -1; }; // בלי תתי-משימות: בסוף
const TASK_SORTS = {
  'due-asc': (a, b) => cmpDue(a, b, 1),
  'due-desc': (a, b) => cmpDue(a, b, -1),
  project: (a, b) => cmpEmptyLast(a.project && projectName(a.project), b.project && projectName(b.project), (x, y) => x.localeCompare(y, 'he')) || cmpDue(a, b, 1),
  title: (a, b) => a.title.localeCompare(b.title, 'he'),
  newest: (a, b) => (b.created || 0) - (a.created || 0),
  oldest: (a, b) => (a.created || 0) - (b.created || 0),
  'subs-open': (a, b) => openSubs(b) - openSubs(a) || cmpDue(a, b, 1),
  progress: (a, b) => doneRatio(b) - doneRatio(a) || cmpDue(a, b, 1),
};
document.addEventListener('change', (ev) => {
  if (ev.target.id !== 'tsort') return;
  const f = TASK_SORTS[ev.target.value]; if (f) setTasksOrder(openTasks().sort(f).map((t) => t.id)); // ה-sort יציב: שוויון שומר את הסדר הקודם
});
function setTasksOrder(ids) {
  const open = ids.map((id) => by(S.tasks, id)).filter(Boolean);
  S.tasks = [...open, ...S.tasks.filter((t) => t.done || !open.includes(t))];
  save(); render();
}
function setSubsOrder(tid, ids) {
  const t = by(S.tasks, tid); if (!t) return;
  const open = ids.map((id) => by(t.subs || [], id)).filter(Boolean);
  t.subs = [...open, ...(t.subs || []).filter((x) => x.done || !open.includes(x))];
  save(); render();
}
const SUB_F = () => [{ k: 'title', label: 'תת-משימה' }, { k: 'due', label: 'תאריך יעד', type: 'date' }];
const TASK_F = () => [{ k: 'title', label: 'משימה' }, { k: 'project', label: 'פרויקט', type: 'select', opts: [['', '— ללא —'], ...projectOpts()] }, { k: 'due', label: 'תאריך יעד', type: 'date' }];

/* ---------- שעות וחשבוניות ---------- */
function finance() {
  const pending = S.time.filter((t) => !t.invoice);
  return `<h1>שעות וחשבוניות</h1>
  <div class="card"><div class="bar"><h2>רישום שעות</h2><span><button data-do="rate">תעריף שעתי: ${money(S.settings.rate)}</button> <button class="pri" data-do="timeNew">+ שעות</button></span></div>
  ${S.time.length ? `<div class="scroll"><table><tr><th>תאריך</th><th>פרויקט</th><th>תיאור</th><th>שעות</th><th>סכום</th><th></th></tr>${[...S.time].reverse().map((t) => `<tr><td>${esc(t.date)}</td><td>${esc(projectName(t.project))}</td><td>${esc(t.desc)}</td><td>${t.hours}</td><td>${money(t.hours * t.rate)}</td><td>${t.invoice ? '<span class="tag ok">חויב</span>' : `<button class="sm del" data-do="timeDel" data-id="${t.id}">מחיקה</button>`}</td></tr>`).join('')}</table></div>` : '<div class="empty">לא נרשמו שעות</div>'}
  ${pending.length ? `<div class="row"><button class="pri" data-do="invoiceMake">הפקת חשבונית מ-${pending.length} רישומים (${money(pending.reduce((a, t) => a + t.hours * t.rate, 0))})</button></div>` : ''}</div>
  <div class="card"><h2>חשבוניות</h2>${S.invoices.length ? `<div class="scroll"><table><tr><th>מס׳</th><th>תאריך</th><th>לקוח</th><th>סכום</th><th>סטטוס</th><th></th></tr>${S.invoices.map((i) => `<tr><td>${i.no}</td><td>${esc(i.date)}</td><td>${esc(clientName(i.client))}</td><td>${money(i.total)}</td>
  <td><span class="tag ${i.paid ? 'ok' : 'warn'}">${i.paid ? 'שולמה' : 'פתוחה'}</span></td><td><button class="sm" data-do="invoicePay" data-id="${i.id}">${i.paid ? 'סמן כפתוחה' : 'סמן כשולמה'}</button> <button class="sm" data-do="invoicePrint" data-id="${i.id}">צפייה</button></td></tr>`).join('')}</table></div>` : '<div class="empty">אין חשבוניות</div>'}</div>`;
}
const TIME_F = () => [{ k: 'project', label: 'פרויקט', type: 'select', opts: projectOpts() }, { k: 'date', label: 'תאריך', type: 'date', def: today() }, { k: 'hours', label: 'שעות', type: 'number', def: 1 }, { k: 'desc', label: 'תיאור העבודה' }];

/* ---------- אבחון עסקי ---------- */
const AREAS = {
  'אסטרטגיה': ['לעסק חזון ויעדים כתובים לשנה הקרובה', 'ברורה ההצעה הייחודית שלנו מול מתחרים', 'יש מעקב רבעוני אחרי יעדים', 'אנחנו מכירים היטב את השוק והמגמות בו'],
  'שיווק ומכירות': ['קהל היעד מוגדר בבירור', 'קיים תהליך מכירה קבוע ומדיד', 'יש זרם יציב של לידים חדשים', 'שיעור הלקוחות החוזרים מספק'],
  'תפעול': ['תהליכי העבודה המרכזיים מתועדים', 'איכות השירות עקבית בין לקוחות', 'שימוש יעיל בכלים דיגיטליים ובאוטומציה', 'ניהול ספקים ומלאי / משאבים תקין'],
  'כספים': ['יש תזרים מזומנים מנוהל ותחזית', 'המחירים מבוססים על חישוב רווחיות', 'גבייה מהלקוחות מתבצעת בזמן', 'קיימת רזרבה לפחות לשלושה חודשי פעילות'],
  'צוות וניהול': ['תפקידים ואחריות מוגדרים לכל אדם', 'יש תהליך קליטה והדרכה לעובדים', 'מתקיימים משובים ושיחות פיתוח', 'הבעלים אינו צוואר הבקבוק בכל החלטה'],
};
const ADVICE = {
  'אסטרטגיה': 'לנסח חזון ו-3 יעדים מדידים (OKR), ולקבוע פגישת סקירה רבעונית.',
  'שיווק ומכירות': 'להגדיר פרסונת לקוח ומשפך מכירה, ולמדוד המרה בכל שלב.',
  'תפעול': 'לתעד את 3 התהליכים הקריטיים ולהחליף עבודה ידנית חוזרת באוטומציה.',
  'כספים': 'לבנות תחזית תזרים ל-12 חודשים (ראה לשונית "תוכנית ותחזית"), ולבדוק תמחור ומרווח.',
  'צוות וניהול': 'להגדיר תיאורי תפקיד, ולהאציל סמכויות החלטה מוגדרות.',
};
const scoreOf = (d) => Object.keys(AREAS).map((a, ai) => {
  const vals = AREAS[a].map((_, qi) => num(d.answers[ai * 4 + qi]) || 0);
  return { area: a, pct: Math.round((vals.reduce((x, y) => x + y, 0) / (vals.length * 5)) * 100) };
});
function diagnostic() {
  return `<h1>אבחון עסקי</h1><div class="card no-print"><div class="bar"><span class="muted">שאלון של 20 שאלות, ניתוח SWOT והמלצות אוטומטיות</span><button class="pri" data-do="diagNew">+ אבחון חדש</button></div>
  ${S.diagnostics.length ? `<table>${S.diagnostics.map((d) => { const sc = scoreOf(d); const tot = Math.round(sc.reduce((a, x) => a + x.pct, 0) / sc.length); return `<tr><td>${esc(d.date)}</td><td>${esc(clientName(d.client))}</td><td>ציון כולל: <b>${tot}%</b></td><td><button class="sm" data-do="diagView" data-id="${d.id}">דוח</button> <button class="sm del" data-do="diagDel" data-id="${d.id}">מחיקה</button></td></tr>`; }).join('')}</table>` : '<div class="empty">עדיין לא בוצע אבחון</div>'}</div>
  <div id="report"></div>`;
}
function diagForm() {
  const dlg = $('#dlg');
  let i = 0;
  dlg.innerHTML = `<form method="dialog" style="max-height:80vh;overflow:auto"><h2>אבחון חדש</h2><label>לקוח</label><select name="client">${clientOpts().map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>
  ${Object.entries(AREAS).map(([a, qs]) => `<h2 style="margin-top:14px">${a}</h2>${qs.map((q) => `<div class="q"><span>${esc(q)}</span><select name="a${i++}">${[1, 2, 3, 4, 5].map((n) => `<option ${n === 3 ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`).join('')}`).join('')}
  <p class="muted">1 = בכלל לא נכון, 5 = נכון מאוד</p>
  ${['חוזקות', 'חולשות', 'הזדמנויות', 'איומים'].map((s, k) => `<label>${s}</label><textarea name="s${k}"></textarea>`).join('')}
  <div class="row"><button class="pri" value="ok">שמירת אבחון</button><button value="cancel" formnovalidate>ביטול</button></div></form>`;
  dlg.querySelector('form').onsubmit = (ev) => {
    if (ev.submitter?.value !== 'ok') return;
    const fd = new FormData(ev.target);
    S.diagnostics.push({ id: uid(), date: today(), client: fd.get('client'), answers: Array.from({ length: 20 }, (_, k) => num(fd.get('a' + k))), swot: [0, 1, 2, 3].map((k) => String(fd.get('s' + k) || '').trim()) });
    save(); render();
  };
  dlg.showModal();
}
function diagReport(id) {
  const d = by(S.diagnostics, id); if (!d) return;
  const sc = scoreOf(d); const tot = Math.round(sc.reduce((a, x) => a + x.pct, 0) / sc.length);
  const weak = [...sc].sort((a, b) => a.pct - b.pct).filter((x) => x.pct < 70);
  const names = ['חוזקות', 'חולשות', 'הזדמנויות', 'איומים'];
  $('#report').innerHTML = `<div class="card"><div class="bar"><h2>דוח אבחון — ${esc(clientName(d.client))} (${esc(d.date)})</h2></div>
  <p>ציון כולל: <b>${tot}%</b></p>
  ${sc.map((x) => `<div style="margin:8px 0"><div class="bar" style="margin:0"><span>${x.area}</span><b>${x.pct}%</b></div><div class="meter"><i style="width:${x.pct}%;background:${x.pct < 50 ? 'var(--bad)' : x.pct < 70 ? 'var(--warn)' : 'var(--ok)'}"></i></div></div>`).join('')}
  <h2 style="margin-top:16px">המלצות</h2>${weak.length ? `<ol>${weak.map((x) => `<li><b>${x.area} (${x.pct}%)</b> — ${ADVICE[x.area]}</li>`).join('')}</ol>` : '<p>כל התחומים בטווח תקין. מומלץ להתמקד בצמיחה ובמינוף החוזקות.</p>'}
  <h2>ניתוח SWOT</h2><div class="swot">${names.map((n, k) => `<div class="card" style="margin:0"><b>${n}</b><p style="white-space:pre-wrap">${esc(d.swot[k]) || '<span class="muted">—</span>'}</p></div>`).join('')}</div></div>`;
  $('#report').scrollIntoView({ behavior: 'smooth' });
}

/* ---------- תוכנית ותחזית ---------- */
function forecast(p) {
  const rows = []; let cash = p.cash; let be = null; let runway = null;
  for (let m = 1; m <= p.months; m++) {
    const rev = p.revenue * Math.pow(1 + p.growth / 100, m - 1);
    const gross = rev * (1 - p.cogs / 100); const net = gross - p.fixed;
    cash += net; rows.push({ m, rev, gross, net, cash });
    if (be === null && net >= 0) be = m;
    if (runway === null && cash < 0) runway = m;
  }
  return { rows, be, runway };
}
function plan() {
  const p = S.plan; const { rows, be, runway } = forecast(p);
  const W = 640, H = 220, maxV = Math.max(1, ...rows.map((r) => Math.max(r.rev, r.cash))); const minV = Math.min(0, ...rows.map((r) => r.cash));
  const x = (i) => 40 + (i * (W - 60)) / Math.max(1, rows.length - 1); const y = (v) => H - 20 - ((v - minV) / (maxV - minV || 1)) * (H - 40);
  const line = (k, c) => `<polyline fill="none" stroke="${c}" stroke-width="2.5" points="${rows.map((r, i) => `${x(i)},${y(r[k])}`).join(' ')}"/>`;
  const last = rows[rows.length - 1];
  return `<h1>תוכנית ותחזית פיננסית</h1><div class="card no-print"><div class="bar"><h2>הנחות</h2><button class="pri" data-do="planEdit">עריכת הנחות</button></div>
  <div class="grid">${stat(money(p.cash), 'מזומן פתיחה')}${stat(money(p.revenue), 'הכנסה חודשית התחלתית')}${stat(p.growth + '%', 'צמיחה חודשית')}${stat(p.cogs + '%', 'עלות ישירה מההכנסה')}${stat(money(p.fixed), 'הוצאות קבועות לחודש')}${stat(p.months, 'חודשי תחזית')}</div></div>
  <div class="grid">${stat(be ? 'חודש ' + be : 'לא בטווח', 'נקודת איזון תפעולית')}${stat(runway ? 'חודש ' + runway : 'אין גירעון', 'המזומן נגמר')}${stat(money(last.cash), 'מזומן בסוף התקופה')}${stat(money(rows.reduce((a, r) => a + r.net, 0)), 'רווח מצטבר')}</div>
  <div class="card" style="margin-top:16px"><h2>הכנסות (כחול) ויתרת מזומן (ירוק)</h2><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="גרף תחזית">
  <line x1="40" x2="${W - 20}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)"/>${line('rev', 'var(--pri)')}${line('cash', 'var(--ok)')}
  ${rows.map((r, i) => `<text x="${x(i)}" y="${H - 4}" font-size="10" text-anchor="middle" fill="var(--mut)">${r.m}</text>`).join('')}</svg></div>
  <div class="card scroll"><div class="bar"><h2>טבלה חודשית</h2><button class="no-print" data-do="planCsv">ייצוא CSV</button></div><table><tr><th>חודש</th><th>הכנסה</th><th>רווח גולמי</th><th>רווח נקי</th><th>יתרת מזומן</th></tr>
  ${rows.map((r) => `<tr><td>${r.m}</td><td>${money(r.rev)}</td><td>${money(r.gross)}</td><td style="color:${r.net < 0 ? 'var(--bad)' : 'inherit'}">${money(r.net)}</td><td style="color:${r.cash < 0 ? 'var(--bad)' : 'inherit'}">${money(r.cash)}</td></tr>`).join('')}</table></div>`;
}
const PLAN_F = () => [{ k: 'cash', label: 'מזומן פתיחה (₪)', type: 'number' }, { k: 'revenue', label: 'הכנסה חודשית התחלתית (₪)', type: 'number' }, { k: 'growth', label: 'צמיחה חודשית (%)', type: 'number' }, { k: 'cogs', label: 'עלות ישירה מההכנסה (%)', type: 'number' }, { k: 'fixed', label: 'הוצאות קבועות לחודש (₪)', type: 'number' }, { k: 'months', label: 'חודשי תחזית (1–36)', type: 'number' }];

/* ---------- שוק ייעוץ ---------- */
const AREA_OPTS = [...Object.keys(AREAS), 'אחר'].map((a) => [a, a]);
function market() { return Cloud.enabled ? marketCloud() : marketLocal(); }
function marketLocal() {
  return `<h1>שוק ייעוץ</h1><p class="muted">לקוח מתאר צורך, יועצים מגישים הצעות מחיר, והלקוח בוחר. (הדגמה מקומית — ללא שרת)</p>
  <div class="bar"><span></span><button class="pri" data-do="reqNew">+ בקשת ייעוץ</button></div>
  ${S.requests.length ? S.requests.map((r) => {
    const q = r.quotes || []; const min = q.length ? Math.min(...q.map((x) => x.price)) : 0;
    return `<div class="card"><div class="bar"><div><h2 style="margin:0">${esc(r.title)} <span class="tag ${r.accepted ? 'ok' : ''}">${r.accepted ? 'נבחרה הצעה' : 'פתוחה'}</span></h2><span class="muted">${esc(r.area)} · תקציב ${money(r.budget)} · ${esc(clientName(r.client))}</span></div>
    <span>${r.accepted ? '' : `<button class="sm" data-do="quoteNew" data-id="${r.id}">+ הצעת מחיר</button> `}<button class="sm del" data-do="reqDel" data-id="${r.id}">מחיקה</button></span></div>
    <p>${esc(r.desc)}</p>${q.length ? `<div class="scroll"><table><tr><th>יועץ</th><th>מחיר</th><th>ימים</th><th>הודעה</th><th></th></tr>${q.map((x) => `<tr><td>${esc(x.consultant)}${x.price === min ? ' <span class="tag ok">הזול ביותר</span>' : ''}</td><td>${money(x.price)}</td><td>${x.days}</td><td>${esc(x.msg)}</td>
    <td>${r.accepted === x.id ? '<span class="tag ok">נבחרה</span>' : r.accepted ? '' : `<button class="sm pri" data-do="quoteAccept" data-id="${r.id}" data-q="${x.id}">אישור</button>`}</td></tr>`).join('')}</table></div>` : '<div class="empty">עדיין אין הצעות</div>'}</div>`;
  }).join('') : '<div class="card empty">אין בקשות ייעוץ</div>'}`;
}

/* שוק משותף (מצב ענן): הבעלים רואה את כל ההצעות, יועץ רואה רק את ההצעה שלו */
function marketCloud() {
  const mine = M.filter((r) => r.ownerUid === me.uid); const others = M.filter((r) => r.ownerUid !== me.uid);
  const status = (r) => `<span class="tag ${r.accepted ? 'ok' : ''}">${r.accepted ? 'נבחרה הצעה' : 'פתוחה'}</span>`;
  const meta = (r) => `${esc(r.area)} · תקציב ${money(r.budget)} · ${esc(r.clientLabel || r.ownerName)}`;
  const mineCard = (r) => {
    const q = r.quotes; const min = q.length ? Math.min(...q.map((x) => x.price)) : 0;
    return `<div class="card"><div class="bar"><div><h2 style="margin:0">${esc(r.title)} ${status(r)}</h2><span class="muted">${meta(r)}</span></div>
    <button class="sm del" data-do="reqDel" data-id="${r.id}">מחיקה</button></div><p>${esc(r.desc)}</p>
    ${q.length ? `<div class="scroll"><table><tr><th>יועץ</th><th>מחיר</th><th>ימים</th><th>הודעה</th><th></th></tr>${q.map((x) => `<tr><td>${esc(x.consultant)}${x.price === min ? ' <span class="tag ok">הזול ביותר</span>' : ''}</td><td>${money(x.price)}</td><td>${num(x.days)}</td><td>${esc(x.msg)}</td>
    <td>${r.accepted === x.consultantUid ? '<span class="tag ok">נבחרה</span>' : r.accepted ? '' : `<button class="sm pri" data-do="quoteAccept" data-id="${r.id}" data-q="${esc(x.consultantUid)}">אישור</button>`}</td></tr>`).join('')}</table></div>` : '<div class="empty">עדיין אין הצעות</div>'}</div>`;
  };
  const otherCard = (r) => {
    const q = r.quotes[0]; const won = r.accepted && r.accepted === me.uid;
    return `<div class="card"><div class="bar"><div><h2 style="margin:0">${esc(r.title)} ${status(r)}</h2><span class="muted">${meta(r)}</span></div>
    <span>${r.accepted ? '' : `<button class="sm pri" data-do="quoteNew" data-id="${r.id}">${q ? 'עדכון הצעה' : 'הגשת הצעה'}</button>`} ${q && !r.accepted ? `<button class="sm del" data-do="quoteDel" data-id="${r.id}">משיכה</button>` : ''}</span></div>
    <p>${esc(r.desc)}</p>${q ? `<p class="muted">ההצעה שלך: ${money(q.price)} · ${num(q.days)} ימים ${won ? '<span class="tag ok">נבחרה!</span>' : ''}</p>` : ''}</div>`;
  };
  return `<h1>שוק ייעוץ</h1><p class="muted">מפרסמים בקשת ייעוץ ומקבלים הצעות מחיר, או מגישים הצעה לבקשות של אחרים. הצעות המחיר גלויות רק לבעל הבקשה ולמגיש.</p>
  <div class="bar"><h2>הבקשות שלי</h2><button class="pri" data-do="reqNew">+ בקשת ייעוץ</button></div>${mine.length ? mine.map(mineCard).join('') : '<div class="card empty">לא פרסמת בקשות</div>'}
  <h2>בקשות של אחרים</h2>${others.length ? others.map(otherCard).join('') : '<div class="card empty">אין בקשות פתוחות</div>'}`;
}
const REQ_F = () => [{ k: 'title', label: 'כותרת הבקשה' }, { k: 'client', label: 'לקוח', type: 'select', opts: clientOpts() }, { k: 'area', label: 'תחום', type: 'select', opts: AREA_OPTS }, { k: 'budget', label: 'תקציב (₪)', type: 'number' }, { k: 'desc', label: 'תיאור הצורך', type: 'textarea' }];
const REQ_CLOUD_F = () => [{ k: 'title', label: 'כותרת הבקשה' }, { k: 'clientLabel', label: 'שם העסק (יוצג ליועצים)' }, { k: 'area', label: 'תחום', type: 'select', opts: AREA_OPTS }, { k: 'budget', label: 'תקציב (₪)', type: 'number' }, { k: 'desc', label: 'תיאור הצורך', type: 'textarea' }];
const QUOTE_F = [{ k: 'consultant', label: 'שם היועץ' }, { k: 'price', label: 'מחיר (₪)', type: 'number' }, { k: 'days', label: 'ימי עבודה', type: 'number' }, { k: 'msg', label: 'הודעה ללקוח', type: 'textarea' }];

/* ---------- פעולות ---------- */
const need = (cond, msg) => { if (!cond) note(msg); return cond; };
const delFrom = (list, id, extra) => ask('למחוק?', () => { const i = list.findIndex((x) => x.id === id); if (i >= 0) list.splice(i, 1); extra?.(); save(); render(); });
const ACTIONS = {
  clientNew: () => form('לקוח חדש', CLIENT_F(), null, (v) => { if (v.name) S.clients.push({ id: uid(), ...v }); }),
  clientEdit: (id) => form('עריכת לקוח', CLIENT_F(), by(S.clients, id), (v) => Object.assign(by(S.clients, id), v)),
  clientDel: (id) => delFrom(S.clients, id),
  projectNew: () => need(S.clients.length, 'יש להוסיף לקוח קודם') && form('פרויקט חדש', PROJECT_F(), { status: 'פעיל' }, (v) => { if (v.name) S.projects.push({ id: uid(), ...v }); }),
  projectEdit: (id) => form('עריכת פרויקט', PROJECT_F(), by(S.projects, id), (v) => Object.assign(by(S.projects, id), v)),
  projectDel: (id) => delFrom(S.projects, id, () => { S.tasks = S.tasks.filter((t) => t.project !== id); S.time = S.time.filter((t) => t.project !== id || t.invoice); }),
  taskNew: () => form('משימה חדשה', TASK_F(), null, (v) => { if (v.title) S.tasks.push({ id: uid(), done: false, created: Date.now(), ...v }); }),
  taskEdit: (id) => form('עריכת משימה', TASK_F(), by(S.tasks, id), (v) => Object.assign(by(S.tasks, id), v)),
  taskDel: (id) => delFrom(S.tasks, id),
  taskToggle: (id) => { const t = by(S.tasks, id); t.done = !t.done; save(); render(); },
  taskFold: (id) => { collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); render(); },
  subNew: (id) => form('תת-משימה חדשה', SUB_F(), null, (v) => { if (v.title) { const t = by(S.tasks, id); (t.subs ||= []).push({ id: uid(), done: false, ...v }); collapsed.delete(id); } }),
  subEdit: (id, d) => form('עריכת תת-משימה', SUB_F(), by(by(S.tasks, id).subs, d.sid), (v) => Object.assign(by(by(S.tasks, id).subs, d.sid), v)),
  subDel: (id, d) => ask('למחוק את תת-המשימה?', () => { const t = by(S.tasks, id); t.subs = t.subs.filter((x) => x.id !== d.sid); save(); render(); }),
  subToggle: (id, d) => { const x = by(by(S.tasks, id).subs, d.sid); x.done = !x.done; save(); render(); },
  subSort: (id) => setSubsOrder(id, (by(S.tasks, id).subs || []).filter((x) => !x.done).sort((p, q) => (p.due || '9').localeCompare(q.due || '9')).map((x) => x.id)),
  rate: () => form('תעריף שעתי', [{ k: 'rate', label: 'תעריף שעתי (₪)', type: 'number' }], S.settings, (v) => { if (v.rate > 0) S.settings.rate = v.rate; }),
  timeNew: () => need(S.projects.length, 'יש להוסיף פרויקט קודם') && form('רישום שעות', TIME_F(), null, (v) => { if (v.hours > 0) S.time.push({ id: uid(), rate: S.settings.rate, ...v }); }),
  timeDel: (id) => delFrom(S.time, id),
  invoiceMake: () => {
    const pend = S.time.filter((t) => !t.invoice); if (!pend.length) return;
    const groups = {};
    pend.forEach((t) => { const c = by(S.projects, t.project)?.client || ''; (groups[c] ||= []).push(t); });
    let no = S.invoices.reduce((m, i) => Math.max(m, i.no), 1000);
    Object.entries(groups).forEach(([client, items]) => {
      const inv = { id: uid(), no: ++no, date: today(), client, paid: false, total: items.reduce((a, t) => a + t.hours * t.rate, 0), lines: items.map((t) => ({ desc: `${projectName(t.project)} — ${t.desc}`, hours: t.hours, rate: t.rate })) };
      items.forEach((t) => { t.invoice = inv.id; }); S.invoices.push(inv);
    });
    save(); render();
  },
  invoicePay: (id) => { const i = by(S.invoices, id); i.paid = !i.paid; save(); render(); },
  invoicePrint: (id) => {
    const i = by(S.invoices, id); const vat = i.total * 0.18;
    show(`<form method="dialog"><h2>חשבונית מס׳ ${i.no}</h2><p>תאריך: ${esc(i.date)}<br>לקוח: ${esc(clientName(i.client))}</p>
    <table>${i.lines.map((l) => `<tr><td>${esc(l.desc)}</td><td>${l.hours} ש׳</td><td>${money(l.hours * l.rate)}</td></tr>`).join('')}</table>
    <p>לפני מע״מ: ${money(i.total)}<br>מע״מ (18%): ${money(vat)}<br><b>סה״כ: ${money(i.total + vat)}</b></p><p class="muted">מסמך הדגמה, אינו חשבונית מס רשמית.</p><div class="row"><button class="pri">סגירה</button></div></form>`);
  },
  diagNew: () => diagForm(),
  diagView: (id) => diagReport(id),
  diagDel: (id) => delFrom(S.diagnostics, id),
  planEdit: () => form('הנחות התחזית', PLAN_F(), S.plan, (v) => { v.months = Math.min(36, Math.max(1, Math.round(v.months) || 12)); Object.assign(S.plan, v); }),
  planCsv: () => {
    const { rows } = forecast(S.plan);
    const csv = 'חודש,הכנסה,רווח גולמי,רווח נקי,יתרת מזומן\n' + rows.map((r) => [r.m, r.rev, r.gross, r.net, r.cash].map((n) => Math.round(n)).join(',')).join('\n');
    textBox('ייצוא CSV', csv, 'העתק והדבק ב-Excel או Google Sheets.');
  },
  reqNew: () => (Cloud.enabled
    ? form('בקשת ייעוץ חדשה', REQ_CLOUD_F(), { area: 'אסטרטגיה' }, async (v) => { if (v.title) { const r = await Cloud.createRequest(me, v); if (!r.ok) note(r.error); } })
    : form('בקשת ייעוץ חדשה', REQ_F(), { area: 'אסטרטגיה' }, (v) => { if (v.title) S.requests.push({ id: uid(), quotes: [], accepted: null, ...v }); })),
  reqDel: (id) => (Cloud.enabled
    ? ask('למחוק את הבקשה ואת כל ההצעות עליה?', async () => { const r = await Cloud.deleteRequest(id); if (!r.ok) note(r.error); })
    : delFrom(S.requests, id)),
  quoteNew: (id) => {
    const mineQ = Cloud.enabled ? by(M, id)?.quotes[0] : null;
    form('הצעת מחיר', QUOTE_F, mineQ || { consultant: Cloud.enabled ? me.name : '' }, async (v) => {
      if (!(v.consultant && v.price > 0)) return;
      if (Cloud.enabled) { const r = await Cloud.submitQuote(me, id, v); if (!r.ok) note(r.error); } else by(S.requests, id).quotes.push({ id: uid(), ...v });
    });
  },
  quoteDel: (id) => ask('למשוך את ההצעה?', async () => { const r = await Cloud.withdrawQuote(me, id); if (!r.ok) note(r.error); }),
  quoteAccept: (id, d) => {
    const r = Cloud.enabled ? by(M, id) : by(S.requests, id);
    const q = Cloud.enabled ? r.quotes.find((x) => x.consultantUid === d.q) : r.quotes.find((x) => x.id === d.q);
    ask(`לאשר את ההצעה של ${q.consultant}? ייווצר גם פרויקט חדש.`, async () => {
      if (Cloud.enabled) {
        const res = await Cloud.acceptQuote(id, q.consultantUid); if (!res.ok) return note(res.error);
        S.projects.push({ id: uid(), name: r.title, client: '', status: 'פעיל', budget: q.price });
      } else { r.accepted = q.id; S.projects.push({ id: uid(), name: r.title, client: r.client, status: 'פעיל', budget: q.price }); }
      save(); render();
    });
  },
  profNew: () => { wiz = { step: 0, data: { hours: '10' }, editId: null }; profOpen = null; render(); scrollTo(0, 0); },
  profOpen: (id) => { profOpen = id; render(); scrollTo(0, 0); },
  profBack: () => { profOpen = null; render(); },
  profEdit: (id) => { wiz = { step: 0, data: JSON.parse(JSON.stringify(by(S.profiles, id).answers)), editId: id }; profOpen = null; render(); scrollTo(0, 0); },
  profDel: (id) => ask('למחוק את האפיון והתוכנית? משימות שכבר נוצרו מהתוכנית יישארו.', () => { S.profiles = S.profiles.filter((x) => x.id !== id); if (profOpen === id) profOpen = null; save(); render(); }),
  profTasks: (id) => { // משימה לכל שלב, עם תתי-משימות ותאריכי יעד
    const p = by(S.profiles, id); if (!p) return;
    [1, 2, 3, 4].forEach((ph) => {
      const items = p.plan.filter((x) => x.phase === ph); if (!items.length) return;
      const due = pDate(p.createdAt, P_PHASES[ph].days);
      S.tasks.push({ id: uid(), title: `${p.name} · ${P_PHASES[ph].label}`, project: '', due, done: false, created: Date.now(), subs: items.map((x) => ({ id: uid(), title: x.title, due, done: false })) });
    });
    p.tasksAdded = true; save(); location.hash = '#tasks'; render();
  },
  wizCancel: () => ask('לבטל את האפיון? מה שמילאת לא יישמר.', () => { wiz = null; render(); }),
  wizBack: () => { wiz.step = Math.max(0, wiz.step - 1); render(); scrollTo(0, 0); },
  wizNext: () => {
    const e = wizCheck(); if (e) { $('#wizErr').textContent = e; return; }
    if (wiz.step < WIZ_STEPS.length - 1) { wiz.step++; render(); scrollTo(0, 0); return; }
    const d = wiz.data; const base = Date.now(); const b = buildProfile(d, base);
    const rec = { id: wiz.editId || uid(), name: d.name.trim(), role: d.role, answers: d, archetype: b.archetype, ranked: b.ranked, low: b.low, top: b.top, plan: b.plan, notes: b.notes, createdAt: base, tasksAdded: false };
    const i = S.profiles.findIndex((x) => x.id === rec.id); if (i >= 0) S.profiles[i] = rec; else S.profiles.push(rec);
    profOpen = rec.id; wiz = null; save(); render(); scrollTo(0, 0);
  },
  saveRetry: () => Cloud.retryNow(),
  logout: async () => { await Cloud.signOut(); },
  adminRefresh: () => { adminData = null; render(); },
  adminOpen: (id) => { adminUser = id; render(); scrollTo(0, 0); },
  adminBack: () => { adminUser = null; render(); },
  togglePw: () => { // עין: מציג או מסתיר את הסיסמה, והפוקוס נשאר בשדה
    const pw = $('#pw'); const b = $('.eye'); const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password'; b.innerHTML = show ? EYE_OFF : EYE;
    b.setAttribute('aria-pressed', String(show)); const t = show ? 'הסתר סיסמה' : 'הצג סיסמה'; b.setAttribute('aria-label', t); b.title = t; pw.focus();
  },
  tourStart: () => tourStart(),
  tourNext: () => tourNext(),
  tourBack: () => tourBack(),
  tourFinish: () => tourFinish(),
  signup: async () => { const [em, pw] = creds(); const r = await Cloud.signUp(em, pw); if (!r.ok) authMsg(r.error); },
  googleIn: async () => { const r = await Cloud.google(); if (!r.ok) authMsg(r.error); },
  forgot: async () => { const [em] = creds(); if (!em) return authMsg('יש להזין מייל או שם משתמש'); const r = await Cloud.reset(em); authMsg(r.ok ? 'נשלח מייל לאיפוס סיסמה' : r.error, r.ok); },
  export: () => textBox('גיבוי נתונים', JSON.stringify(S), 'העתק ושמור את הטקסט בקובץ. לשחזור השתמש ב״ייבוא״.'),
  import: () => show('<form method="dialog"><h2>ייבוא גיבוי</h2><p class="muted">הדבק כאן את טקסט הגיבוי. הנתונים הנוכחיים יוחלפו.</p><textarea id="imp" style="min-height:160px;direction:ltr"></textarea><div class="row"><button class="pri" value="ok">ייבוא</button><button value="cancel" formnovalidate>ביטול</button></div></form>', (d) => {
    d.querySelector('form').onsubmit = (ev) => { if (ev.submitter?.value !== 'ok') return; try { S = Object.assign(empty(), JSON.parse(d.querySelector('#imp').value)); save(); render(); } catch { setTimeout(() => note('הטקסט אינו גיבוי תקין'), 0); } };
  }),
  reset: () => ask('למחוק את כל הנתונים?', () => { S = empty(); save(); render(); }),
};
/* ---------- אפיון אישי: שאלון לפי תפקיד ← תוכנית אישית ל-90 יום ← משימות ---------- */
const P_ROLES = { founder: 'מייסד/ת', partner: 'שותף/ה', therapist: 'מטפל/ת' };
const P_SKILLS = { expertise: 'מומחיות מקצועית', marketing: 'שיווק ונראות', sales: 'מכירות ושימור לקוחות', ops: 'ארגון ותפעול', finance: 'כספים ותמחור', people: 'עבודה עם אנשים וניהול', tech: 'כלים דיגיטליים' };
const P_ARCH = { expertise: 'המומחה/ית', marketing: 'איש/ת הנראות', sales: 'בונה/ת הקשרים', ops: 'המסדר/ת', finance: 'איש/ת המספרים', people: 'המחבר/ת', tech: 'הטכנולוג/ית' };
const P_GOALS = { clients: 'להגדיל את מספר הלקוחות / המטופלים', income: 'להגדיל הכנסה', brand: 'לבנות מותג ונראות', structure: 'לבנות מבנה עבודה מסודר', team: 'להקים צוות או שותפויות', product: 'לפתח שירות או מוצר חדש', balance: 'לשפר איזון בין עבודה לחיים', skills: 'להעמיק מקצועית' };
const P_PHASES = [null, { label: 'שבועיים ראשונים: יסודות', days: 14 }, { label: 'עד יום 30: הקמה', days: 30 }, { label: 'עד יום 60: צמיחה', days: 60 }, { label: 'עד יום 90: סקירה והמשך', days: 90 }];
const P_ROLE_Q = {
  founder: [
    { k: 'stage', label: 'באיזה שלב העסק?', opts: ['רעיון', 'בהקמה', 'פועל עד שנה', 'פועל מעל שנה'] },
    { k: 'teamSize', label: 'כמה אנשים בצוות כרגע (כולל אותך)?', type: 'number', def: 1 },
    { k: 'funding', label: 'ממה ממומן העסק?', opts: ['הון עצמי', 'שותפים', 'משקיע', 'הלוואה / מימון חיצוני'] },
    { k: 'bottleneck', label: 'מה הצוואר בקבוק העיקרי היום?', opts: ['חוסר בלקוחות', 'כסף', 'זמן', 'צוות', 'ידע מקצועי', 'בהירות לגבי הכיוון'] },
  ],
  partner: [
    { k: 'contribution', label: 'מה התרומה העיקרית שלך לשותפות?', opts: ['הון', 'לקוחות ולידים', 'מומחיות מקצועית', 'תפעול וניהול', 'שילוב של כמה'] },
    { k: 'commitment', label: 'רמת המחויבות שלך', opts: ['מלאה', 'חלקית', 'ייעוצית'] },
    { k: 'horizon', label: 'אופק זמן צפוי בשותפות', opts: ['עד שנה', 'שנה עד שלוש', 'מעל שלוש שנים'] },
    { k: 'clarity', label: 'איך מוגדרים התפקידים והתנאים היום?', opts: ['מוגדרים בכתב', 'סוכמו בעל פה', 'עוד לא הוגדרו'] },
  ],
  therapist: [
    { k: 'modality', label: 'תחום / שיטת טיפול', type: 'text' },
    { k: 'setting', label: 'איפה מטפלים?', opts: ['קליניקה פיזית', 'אונליין', 'שילוב'] },
    { k: 'load', label: 'כמה מטופלים בשבוע כיום?', type: 'number', def: 0 },
    { k: 'target', label: 'כמה מטופלים בשבוע ביעד?', type: 'number', def: 10 },
    { k: 'referrals', label: 'מאיפה מגיעים מטופלים בעיקר?', opts: ['הפניות מקצועיות', 'אינטרנט וקהילות', 'קופות / גופים', 'שיווק אישי', 'עוד אין'] },
    { k: 'supervision', label: 'הדרכה / ייעוץ עמיתים', opts: ['קבועה', 'מדי פעם', 'אין'] },
  ],
};
/* תבניות הפעולות. p = עדיפות (0 תמיד נכלל, 1 חיוני, 2 חשוב, 3 תוספת), ph = שלב (1 עד 4) */
const P_BASE = {
  founder: [
    { p: 1, ph: 1, area: 'אסטרטגיה', t: 'לנסח בכתב חזון ושלוש מטרות מדידות ל-90 הימים הקרובים', why: 'בלי יעד כתוב קשה לדעת מה לא לעשות.' },
    { p: 1, ph: 1, area: 'שיווק', t: 'להגדיר את הלקוח האידיאלי ואת הבעיה המרכזית שהעסק פותר לו', why: 'כל החלטה שיווקית ומכירתית נשענת על זה.' },
    { p: 1, ph: 2, area: 'מכירות', t: 'לבדוק את ההצעה מול 5 לקוחות פוטנציאליים ולתעד את המשוב', why: 'בדיקה מוקדמת חוסכת חודשים של בנייה בכיוון שגוי.' },
    { p: 1, ph: 2, area: 'כספים', t: 'לבנות תחזית תזרים ל-12 חודשים (לשונית "תוכנית ותחזית")', why: 'להבין כמה זמן המזומן מחזיק ומה נקודת האיזון.' },
    { p: 2, ph: 3, area: 'כספים', t: 'לקבוע תמחור לפי עלות ורווחיות ולבדוק אותו מול השוק', why: 'תמחור נמוך מדי הוא הסיבה הנפוצה לשחיקה.' },
    { p: 2, ph: 3, area: 'תפעול', t: 'לתעד את שלושת התהליכים המרכזיים בעסק', why: 'תהליך כתוב מאפשר להאציל ולצמוח.' },
    { p: 2, ph: 4, area: 'אסטרטגיה', t: 'להחליט מה ממשיכים, מה משנים ומה מפסיקים, לפי המטרות שנקבעו', why: 'סקירה כנה אחרי 90 יום היא הבסיס לרבעון הבא.' },
  ],
  partner: [
    { p: 1, ph: 1, area: 'שותפות', t: 'לסכם בכתב תפקידים, אחריות וסמכויות החלטה של כל שותף', why: 'רוב המחלוקות בין שותפים נובעות מציפיות לא מוגדרות.' },
    { p: 1, ph: 1, area: 'שותפות', t: 'להגדיר מה כל שותף תורם (הון, זמן, לקוחות, מומחיות) ומה הוא מצפה לקבל', why: 'ליישר ציפיות לפני שהן הופכות לכעס.' },
    { p: 1, ph: 2, area: 'שותפות', t: 'לקבוע פגישת שותפים חודשית קבועה עם סדר יום וסיכום כתוב', why: 'קצב קבוע מונע הפתעות.' },
    { p: 2, ph: 2, area: 'ניהול', t: 'להגדיר לכל שותף שלושה מדדי הצלחה אישיים ל-90 הימים', why: 'מדד ברור מאפשר שיחה עניינית ולא אישית.' },
    { p: 2, ph: 3, area: 'כספים', t: 'להסדיר בכתב חלוקת רווחים, משיכות והחזר הוצאות', why: 'כסף שאינו מוגדר הוא מקור עיקרי למתח.' },
    { p: 2, ph: 3, area: 'שותפות', t: 'לבדוק עם איש מקצוע סעיפי יציאה, מחויבות לאורך זמן והסכם שותפים', why: 'הסדרת יציאה מראש מגינה על כולם.' },
    { p: 2, ph: 4, area: 'שותפות', t: 'סקירת 90 יום: האם התרומה בפועל תואמת את מה שסוכם', why: 'מתאימים את ההסכם למציאות לפני שהפער גדל.' },
  ],
  therapist: [
    { p: 1, ph: 1, area: 'הקמה', t: 'להכין טופס קליטה, הסכמת מטופל ומדיניות ביטולים ותשלום', why: 'מסגרת ברורה מגינה על המטופל ועליך.' },
    { p: 1, ph: 1, area: 'הקמה', t: 'להגדיר איך שומרים תיעוד, סודיות ואבטחת מידע (גם בדיגיטל)', why: 'חובה מקצועית שעדיף להסדיר מההתחלה.' },
    { p: 1, ph: 2, area: 'תפעול', t: 'לבנות לוח שבועי עם שעות קבלה קבועות ויעד מטופלים', why: 'לוח קבוע יוצר יציבות הכנסה וזמן מנוחה.' },
    { p: 2, ph: 2, area: 'תפעול', t: 'להקים כרטיס לכל מטופל בלשונית "לקוחות" ולהפעיל רישום שעות', why: 'מעקב מסודר מאפשר חיוב נכון ותמונה אמיתית של העבודה.' },
    { p: 1, ph: 3, area: 'שיווק', t: 'להגדיר שלושה ערוצי הפניה ולהתחיל בכל אחד פעולה שבועית', why: 'מטופלים מגיעים מערוצים קבועים, לא ממזל.' },
    { p: 2, ph: 3, area: 'שיווק', t: 'להכין פרופיל מקצועי ברור: תחום, שיטה ולמי זה מתאים', why: 'מי שמבין במהירות מה אתה עושה יפנה אליך.' },
    { p: 2, ph: 4, area: 'כספים', t: 'לסקור עומס מטופלים מול היעד ולהתאים תמחור', why: 'מחיר ועומס נקבעים יחד.' },
  ],
};
const P_GAP = {
  expertise: [{ ph: 2, t: 'לקבוע תוכנית התפתחות מקצועית: הכשרה או מפגש הדרכה אחד בחודש' }, { ph: 3, t: 'לתעד שיטת עבודה או מקרה מייצג שאפשר לשתף' }],
  marketing: [{ ph: 2, t: 'לבחור ערוץ תוכן אחד ולפרסם בו פעם בשבוע' }, { ph: 3, t: 'לנסח מסר אחד ברור ולהקים עמוד או פרופיל שמציג אותו' }],
  sales: [{ ph: 2, t: 'לבנות שגרת מעקב: מי פנה, מה נשלח ומתי חוזרים אליו' }, { ph: 3, t: 'לנסח הצעת ערך ולתרגל שיחת היכרות' }],
  ops: [{ ph: 2, t: 'לתעד את התהליך החוזר ביותר ולפשט אותו' }, { ph: 3, t: 'להפעיל סדר עדיפויות שבועי בלשונית "משימות"' }],
  finance: [{ ph: 2, t: 'להקים מעקב חודשי של הכנסות והוצאות' }, { ph: 3, t: 'לבדוק מהי עלות שעת העבודה שלך ולהשוות לתמחור' }],
  people: [{ ph: 2, t: 'לקבוע שיחות אחד על אחד קבועות עם שותפים או צוות' }, { ph: 3, t: 'להגדיר האצלת סמכויות ברורה: מה מחליטים לבד ומה מתייעצים' }],
  tech: [{ ph: 2, t: 'להפעיל כלי לתיאום פגישות וניהול לקוחות (אפשר באפליקציה הזו)' }, { ph: 3, t: 'להפוך משימה חוזרת אחת לאוטומטית' }],
};
const P_GOAL_ACT = {
  clients: { ph: 2, t: 'לקבוע יעד חודשי ללקוחות / מטופלים חדשים ולמדוד אותו' }, income: { ph: 2, t: 'לקבוע יעד הכנסה חודשי ולפרק אותו לשעות ולמחיר' },
  brand: { ph: 3, t: 'לבנות זהות מותג: שם, מסר וחזות אחידה' }, structure: { ph: 2, t: 'לבנות שבוע קבוע עם בלוקים לעבודה, ניהול והתפתחות' },
  team: { ph: 3, t: 'למפות אילו תפקידים חסרים ומי יכול למלא אותם' }, product: { ph: 3, t: 'לתכנן שירות או חבילה חדשה ולבדוק עניין אצל 5 לקוחות' },
  balance: { ph: 2, t: 'לקבוע שעות עבודה קבועות ויום מנוחה קבוע' }, skills: { ph: 3, t: 'לבנות מסלול למידה אישי לרבעון' },
};
const pDate = (base, days) => new Date(base + days * 864e5).toISOString().slice(0, 10);
function buildProfile(a, base = Date.now()) {
  const sk = Object.keys(P_SKILLS).map((k) => ({ k, v: num(a['skill_' + k]) || 3 }));
  const order = Object.keys(P_SKILLS);
  const ranked = [...sk].sort((x, y) => y.v - x.v || order.indexOf(x.k) - order.indexOf(y.k));
  const top = ranked[0]; const low = [...sk].sort((x, y) => x.v - y.v || order.indexOf(x.k) - order.indexOf(y.k)).slice(0, 2);
  const acts = P_BASE[a.role].map((x) => ({ ...x, src: 'role' }));
  const add = (o) => acts.push(o);
  // התאמות לפי תשובות התפקיד
  if (a.role === 'founder') {
    if (['רעיון', 'בהקמה'].includes(a.stage)) add({ p: 1, ph: 1, area: 'הקמה', t: 'לבדוק היבטים משפטיים בסיסיים: סוג עוסק, ביטוח, הסכם סטנדרטי ללקוח', why: 'להתחיל נכון עולה פחות מלתקן אחר כך.' });
    else add({ p: 1, ph: 2, area: 'מכירות', t: 'למדוד המרה ושימור לקוחות ולזהות איפה הלקוחות נושרים', why: 'בעסק פועל, הצמיחה יושבת על הדליפה הגדולה ביותר.' });
    const bn = { 'חוסר בלקוחות': ['שיווק', 'להגדיר ערוץ גיוס לקוחות עיקרי ולהקצות לו שעתיים קבועות בשבוע'], 'כסף': ['כספים', 'לזהות את שלוש ההוצאות הגדולות ולבדוק מה אפשר לצמצם או לדחות'], 'זמן': ['תפעול', 'לזהות שלוש משימות שאפשר להאציל, להפסיק או לאוטמט'], 'צוות': ['ניהול', 'להגדיר תיאור תפקיד לאדם הבא שמצטרף ולמי הוא כפוף'], 'ידע מקצועי': ['התפתחות', 'לבחור מנטור או קורס שסוגר את פער הידע המרכזי'], 'בהירות לגבי הכיוון': ['אסטרטגיה', 'לקיים סדנת כיוון של חצי יום ולסכם החלטה כתובה'] }[a.bottleneck];
    if (bn) add({ p: 1, ph: 2, area: bn[0], t: bn[1], why: `זה הצוואר בקבוק שציינת: "${a.bottleneck}".` });
  }
  if (a.role === 'partner') {
    if (a.clarity !== 'מוגדרים בכתב') add({ p: 0, ph: 1, area: 'שותפות', t: 'לנסח את ההסכמות הקיימות במסמך אחד ולחתום עליו ביחד', why: `סימנת שהתפקידים והתנאים "${a.clarity}". זה הצעד הדחוף ביותר.` });
    const c = { 'לקוחות ולידים': 'לקבוע יעד שבועי של פניות ופגישות חדשות שאתה מביא', 'מומחיות מקצועית': 'להגדיר את אחריותך המקצועית ואת סטנדרט האיכות של השירות', 'תפעול וניהול': 'להגדיר אילו החלטות תפעוליות מתקבלות על ידיך ואילו בהסכמה', 'הון': 'לתעד את לוח הזמנים ותנאי ההשקעה ואת מה ההשקעה מממנת' }[a.contribution];
    if (c) add({ p: 1, ph: 2, area: 'שותפות', t: c, why: `התרומה העיקרית שלך: ${a.contribution}.` });
    if (a.commitment !== 'מלאה') add({ p: 2, ph: 2, area: 'שותפות', t: 'להגדיר בכתב כמה שעות בשבוע והיקף זמינות מצופה ממך', why: `מחויבות ${a.commitment} דורשת הגדרה כדי שלא תיחשב חוסר מעורבות.` });
  }
  if (a.role === 'therapist') {
    if (a.supervision === 'אין') add({ p: 1, ph: 1, area: 'התפתחות', t: 'למצוא מדריך או קבוצת עמיתים ולקבוע פגישה קבועה', why: 'הדרכה היא חלק מהמקצועיות וגם מונעת שחיקה.' });
    if (a.setting !== 'קליניקה פיזית') add({ p: 1, ph: 1, area: 'הקמה', t: 'להגדיר כלי וידאו מאובטח ונוהל לתקלות בזמן פגישה', why: 'טיפול מרחוק דורש פרטיות ואמינות טכנית.' });
    if (a.referrals === 'עוד אין') add({ p: 1, ph: 2, area: 'שיווק', t: 'להציג את עצמך ל-5 גורמים מפנים (רופאים, קליניקות, קהילות) בפגישה או בשיחה', why: 'בלי ערוץ הפניה המטופלים לא יגיעו מעצמם.' });
    if (num(a.target) > Math.max(num(a.load) * 1.5, num(a.load) + 2)) add({ p: 1, ph: 2, area: 'שיווק', t: `לקבוע יעד שבועי של פניות חדשות כדי להגיע מ-${num(a.load)} ל-${num(a.target)} מטופלים בשבוע`, why: 'הפער בין העומס הנוכחי ליעד מחייב מקור פניות קבוע.' });
  }
  // פערים (שתי המיומנויות החלשות) וחוזקה אחת למינוף
  low.forEach((s, i) => P_GAP[s.k].forEach((g) => add({ p: i === 0 ? 1 : 2, ph: g.ph, area: P_SKILLS[s.k], t: g.t, why: `סימנת "${P_SKILLS[s.k]}" ב-${s.v} מתוך 5.`, src: 'gap' })));
  if (top.v >= 4) add({ p: 3, ph: 3, area: P_SKILLS[top.k], t: `למנף את החוזקה "${P_SKILLS[top.k]}": להגדיר איך היא הופכת ליתרון בהצעה שלך`, why: `זו החוזקה הבולטת שלך (${top.v} מתוך 5).` });
  (a.goals || []).forEach((g) => P_GOAL_ACT[g] && add({ p: 1, ph: P_GOAL_ACT[g].ph, area: 'מטרה', t: P_GOAL_ACT[g].t, why: `בחרת את המטרה: ${P_GOALS[g]}.` }));
  add({ p: 0, ph: 4, area: 'סקירה', t: 'פגישת סיכום 90 יום: מה הושג, מה למדנו ומה היעדים לרבעון הבא', why: 'סוגרים מעגל ומתחילים את הרבעון הבא ממקום מדויק.' });
  // התאמה לזמן הפנוי: פחות שעות, פחות פעולות, ורק החשובות
  const hrs = num(a.hours); const cap = hrs < 5 ? 6 : hrs < 15 ? 9 : 13;
  const seen = new Set(); const uniq = acts.filter((x) => (seen.has(x.t) ? false : seen.add(x.t)));
  const chosen = uniq.map((x, i) => ({ ...x, i })).sort((x, y) => x.p - y.p || x.ph - y.ph || x.i - y.i).slice(0, cap).sort((x, y) => x.ph - y.ph || x.p - y.p || x.i - y.i);
  const plan = chosen.map((x) => ({ id: uid(), title: x.t, area: x.area, phase: x.ph, why: x.why }));
  const notes = [];
  notes.push({ 'נינוח': 'קצב נינוח: מומלץ לא יותר משתי פעולות פעילות במקביל.', 'מאוזן': 'קצב מאוזן: שלוש פעולות פעילות במקביל בערך.', 'מהיר': 'קצב מהיר: חשוב להקדיש זמן קבוע לסקירה כדי לא לפספס פרטים.' }[a.pace]);
  notes.push({ 'מנתח/ת': 'מקבל/ת החלטות לפי נתונים: מדוד את מה שמופיע בתוכנית, כך תרגיש/י ביטחון.', 'אינטואיטיבי/ת': 'מקבל/ת החלטות מהבטן: קבע/י רגע קצר של בדיקה מול נתון אחד לפני החלטות גדולות.', 'שיתופי/ת': 'מקבל/ת החלטות בשיתוף: תכנן/י מראש מי מתייעצים איתו בכל החלטה.' }[a.decision]);
  notes.push({ 'כתוב': 'תקשורת כתובה: עדכון קצר בכתב פעם בשבוע וסיכומי החלטות.', 'שיחה': 'תקשורת בשיחה: שיחת סנכרון קצרה קבועה, וסיכום בשורה אחת אחריה.', 'פגישות': 'תקשורת בפגישות: פגישה קבועה בלוח, עם סדר יום וסיכום.' }[a.comm]);
  if (hrs && hrs < 5) notes.push(`עם ${hrs} שעות בשבוע קיצרנו את התוכנית ל-${plan.length} הפעולות החשובות ביותר.`);
  return { role: a.role, archetype: P_ARCH[top.k], ranked, low: low.map((s) => s.k), top: top.k, plan, notes: notes.filter(Boolean), createdAt: base };
}

let wiz = null; // { step, data, editId } אשף האפיון (בזיכרון בלבד עד השמירה)
let profOpen = null; // מזהה אפיון פתוח לצפייה
const WIZ_STEPS = ['מי אתה', 'מטרות', 'חוזקות', 'סגנון עבודה', 'שאלות לתפקיד'];
function profileView() {
  if (wiz) return wizView();
  if (profOpen && by(S.profiles, profOpen)) return profileDetail(by(S.profiles, profOpen));
  const list = S.profiles;
  return `<h1>אפיון אישי</h1><p class="muted">שאלון קצר לכל שותף, מייסד או מטפל. בסופו מתקבלת תוכנית אישית ל-90 יום, שאפשר להפוך בלחיצה למשימות עם תאריכים.</p>
  <div class="bar"><span class="muted">${list.length ? list.length + ' אפיונים' : ''}</span><button class="pri" data-do="profNew">+ אפיון חדש</button></div>
  ${list.length ? list.map((p) => `<div class="card"><div class="bar" style="margin:0"><div><h2 style="margin:0">${esc(p.name)} <span class="tag">${esc(P_ROLES[p.role])}</span> ${p.tasksAdded ? '<span class="tag ok">התוכנית במשימות</span>' : ''}</h2>
    <span class="muted">${esc(p.archetype)} · ${p.plan.length} פעולות · ${esc(new Date(p.createdAt).toLocaleDateString('he-IL'))}</span></div>
    <span><button class="sm pri" data-do="profOpen" data-id="${p.id}">פתח תוכנית</button> <button class="sm" data-do="profEdit" data-id="${p.id}">עריכת אפיון</button> <button class="sm del" data-do="profDel" data-id="${p.id}">מחיקה</button></span></div></div>`).join('')
    : '<div class="card empty"><p>עוד לא מולא אפיון.</p><button class="pri" data-do="profNew">התחל אפיון ראשון</button></div>'}`;
}
const wv = (k, d = '') => esc(wiz.data[k] ?? d);
function wizView() {
  const d = wiz.data; const s = wiz.step; const last = s === WIZ_STEPS.length - 1;
  const sel = (k, opts, ph = '— בחר —') => `<select data-w="${k}"><option value="">${ph}</option>${opts.map((o) => `<option ${d[k] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  let body = '';
  if (s === 0) body = `<label for="w_name">שם</label><input id="w_name" data-w="name" value="${wv('name')}" autocomplete="off">
    <label>תפקיד</label><div class="chips">${Object.entries(P_ROLES).map(([k, v]) => `<label class="chip"><input type="radio" name="role" data-w="role" value="${k}" ${d.role === k ? 'checked' : ''}> ${v}</label>`).join('')}</div>
    <label>ניסיון בתחום</label>${sel('exp', ['עד שנה', '1 עד 3 שנים', '3 עד 7 שנים', 'מעל 7 שנים'])}
    <label for="w_hours">כמה שעות בשבוע אפשר להקדיש לבנייה ולצמיחה?</label><input id="w_hours" data-w="hours" type="number" min="0" max="80" value="${wv('hours', '10')}">`;
  if (s === 1) body = `<p class="muted">בחר עד שלוש מטרות מרכזיות.</p><div class="chips">${Object.entries(P_GOALS).map(([k, v]) => `<label class="chip"><input type="checkbox" data-wg="goals" value="${k}" ${(d.goals || []).includes(k) ? 'checked' : ''}> ${v}</label>`).join('')}</div>
    <p id="wizHint" class="err" role="alert"></p><label for="w_success">איך נראית הצלחה בעוד 90 יום?</label><textarea id="w_success" data-w="success">${wv('success')}</textarea>`;
  if (s === 2) body = `<p class="muted">דרג/י את עצמך מ-1 (חלש) עד 5 (חזק). אין תשובה נכונה.</p>${Object.entries(P_SKILLS).map(([k, v]) => `<div class="q"><span>${v}</span><span class="rate"><input type="range" min="1" max="5" step="1" data-w="skill_${k}" value="${d['skill_' + k] || 3}" aria-label="${esc(v)}"><output>${d['skill_' + k] || 3}</output></span></div>`).join('')}`;
  if (s === 3) body = `<label>קצב עבודה מועדף</label>${sel('pace', ['נינוח', 'מאוזן', 'מהיר'])}<label>איך מקבלים החלטות?</label>${sel('decision', ['מנתח/ת', 'אינטואיטיבי/ת', 'שיתופי/ת'])}
    <label>תקשורת מועדפת</label>${sel('comm', ['כתוב', 'שיחה', 'פגישות'])}<label for="w_obst">מה הדבר שהכי מעכב אותך היום?</label><textarea id="w_obst" data-w="obstacle">${wv('obstacle')}</textarea>`;
  if (s === 4) P_ROLE_Q[d.role].forEach((q) => { if (q.type === 'number' && d[q.k] === undefined) d[q.k] = String(q.def ?? 0); });
  if (s === 4) body = P_ROLE_Q[d.role].map((q) => `<label ${q.opts ? '' : `for="w_${q.k}"`}>${q.label}</label>${q.opts ? sel(q.k, q.opts) : `<input id="w_${q.k}" data-w="${q.k}" type="${q.type || 'text'}" ${q.type === 'number' ? 'min="0"' : ''} value="${wv(q.k, q.def ?? '')}">`}`).join('');
  return `<h1>${wiz.editId ? 'עריכת אפיון' : 'אפיון אישי'}</h1><div class="card wiz"><div class="muted">שלב ${s + 1} מתוך ${WIZ_STEPS.length}: ${WIZ_STEPS[s]}</div><div class="meter" style="margin:6px 0 12px"><i style="width:${((s + 1) / WIZ_STEPS.length) * 100}%"></i></div>
  ${body}<p id="wizErr" class="err" role="alert"></p><div class="row"><button class="pri" data-do="wizNext">${last ? 'צור תוכנית' : 'הבא'}</button>${s > 0 ? '<button data-do="wizBack">הקודם</button>' : ''}<button class="tour-x" data-do="wizCancel">ביטול</button></div></div>`;
}
function wizCheck() {
  const d = wiz.data; const s = wiz.step;
  if (s === 0 && !(d.name || '').trim()) return 'יש להזין שם';
  if (s === 0 && !d.role) return 'יש לבחור תפקיד';
  if (s === 1 && !(d.goals || []).length) return 'יש לבחור לפחות מטרה אחת';
  return '';
}
document.addEventListener('input', (ev) => {
  const t = ev.target; if (!wiz || !t.dataset) return;
  if (t.dataset.wg) { // קבוצת תיבות סימון (עד 3)
    const cur = new Set(wiz.data[t.dataset.wg] || []);
    if (t.checked) { if (cur.size >= 3) { t.checked = false; const h = $('#wizHint'); if (h) h.textContent = 'אפשר לבחור עד שלוש מטרות'; return; } cur.add(t.value); } else cur.delete(t.value);
    wiz.data[t.dataset.wg] = [...cur]; const h = $('#wizHint'); if (h) h.textContent = '';
  } else if (t.dataset.w) { wiz.data[t.dataset.w] = t.value; if (t.type === 'range') t.nextElementSibling.textContent = t.value; }
});
function profileDetail(p) {
  const sk = [...p.ranked].sort((x, y) => y.v - x.v); const day = (n) => pDate(p.createdAt, n);
  const byPhase = [1, 2, 3, 4].map((ph) => ({ ph, items: p.plan.filter((x) => x.phase === ph) })).filter((g) => g.items.length);
  return `<div class="bar"><h1 style="margin:0">${esc(p.name)} <span class="tag">${esc(P_ROLES[p.role])}</span></h1><span><button data-do="profBack">← כל האפיונים</button> <button data-do="profEdit" data-id="${p.id}">עריכת אפיון</button></span></div>
  <div class="card"><h2>${esc(p.archetype)}</h2><p>החוזקה הבולטת: <b>${esc(P_SKILLS[p.top])}</b>. תחומים לחיזוק: <b>${p.low.map((k) => esc(P_SKILLS[k])).join(', ')}</b>.</p>
  ${sk.map((s) => `<div style="margin:8px 0"><div class="bar" style="margin:0"><span>${esc(P_SKILLS[s.k])}</span><b>${s.v}/5</b></div><div class="meter"><i style="width:${s.v * 20}%;background:${s.v <= 2 ? 'var(--warn)' : 'var(--ok)'}"></i></div></div>`).join('')}
  ${(p.answers.goals || []).length ? `<p style="margin-top:12px">מטרות: ${(p.answers.goals || []).map((g) => `<span class="tag">${esc(P_GOALS[g])}</span>`).join(' ')}</p>` : ''}
  ${p.answers.success ? `<p>הצלחה בעוד 90 יום, במילים שלך: <i>${esc(p.answers.success)}</i></p>` : ''}</div>
  <div class="card"><div class="bar"><h2 style="margin:0">תוכנית אישית ל-90 יום</h2>${p.tasksAdded ? '<span class="tag ok">נוספה למשימות</span>' : '<button class="pri" data-do="profTasks" data-id="' + p.id + '">הוסף את התוכנית למשימות</button>'}</div>
  ${byPhase.map((g) => `<h3 style="margin:14px 0 6px">${esc(P_PHASES[g.ph].label)} <span class="muted" style="font-weight:400">· עד ${esc(day(P_PHASES[g.ph].days))}</span></h3><ol>${g.items.map((x) => `<li style="margin-bottom:6px"><b>${esc(x.title)}</b> <span class="tag">${esc(x.area)}</span><br><span class="muted">${esc(x.why)}</span></li>`).join('')}</ol>`).join('')}
  ${p.tasksAdded ? '<p class="muted">אפשר למצוא את התוכנית בלשונית "משימות", עם תאריכים ותתי-משימות שאפשר לתעדף בגרירה.</p>' : '<p class="muted">לחיצה על "הוסף למשימות" יוצרת משימה לכל שלב, עם תתי-משימות ותאריכי יעד.</p>'}</div>
  <div class="card"><h2>איך נעבוד ביחד</h2><ul>${p.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul><p class="muted">התוכנית היא המלצה כללית לתכנון עבודה, ואינה ייעוץ משפטי, פיננסי או רפואי.</p></div>`;
}

/* ---------- ניהול (מנהל בלבד, קריאה בלבד) ---------- */
const ownerSummary = (w) => {
  const d = Object.assign(empty(), w.data);
  const unbilled = d.time.filter((t) => !t.invoice).reduce((x, t) => x + t.hours * t.rate, 0);
  const openInv = d.invoices.filter((i) => !i.paid).reduce((x, i) => x + i.total, 0);
  return { d, unbilled, openInv, openTasks: d.tasks.filter((t) => !t.done).length, active: d.projects.filter((p) => p.status === 'פעיל').length };
};
function adminView() {
  if (!adminData) { loadAdmin(); return '<h1>ניהול</h1><div class="empty">טוען את כל סביבות העבודה…</div>'; }
  if (adminData.error) return `<h1>ניהול</h1><div class="card"><p class="err" style="color:var(--bad)">${esc(adminData.error)}</p><button data-do="adminRefresh">נסה שוב</button></div>`;
  const list = adminData.list; const cn = (d, id) => by(d.clients, id)?.name || '—'; const pn = (d, id) => by(d.projects, id)?.name || '—';
  const head = (sub) => `<div class="bar"><h1 style="margin:0">ניהול <span class="tag">קריאה בלבד</span></h1><span>${sub}<button data-do="adminRefresh">רענון</button></span></div>`;
  if (adminUser) {
    const w = list.find((x) => x.uid === adminUser); if (!w) { adminUser = null; return adminView(); }
    const { d } = ownerSummary(w);
    const tbl = (rows, cols, cells) => rows.length ? `<div class="scroll"><table><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>${rows.map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table></div>` : '<div class="empty">אין נתונים</div>';
    return `${head('<button data-do="adminBack">← כל המשתמשים</button> ')}<h2>${esc(w.label)}</h2>
    <div class="card"><h2>לקוחות (${d.clients.length})</h2>${tbl(d.clients, ['שם', 'איש קשר', 'טלפון / מייל', 'תחום'], (c) => [esc(c.name), esc(c.contact), esc(`${c.phone || ''} ${c.email || ''}`), esc(c.industry)])}</div>
    <div class="card"><h2>פרויקטים (${d.projects.length})</h2>${tbl(d.projects, ['פרויקט', 'לקוח', 'סטטוס', 'תקציב', 'שעות'], (p) => [esc(p.name), esc(cn(d, p.client)), esc(p.status), money(p.budget), d.time.filter((t) => t.project === p.id).reduce((x, t) => x + t.hours, 0)])}</div>
    <div class="card"><h2>משימות (${d.tasks.length})</h2>${tbl(d.tasks, ['משימה', 'פרויקט', 'יעד', 'סטטוס'], (t) => [esc(t.title), esc(pn(d, t.project)), esc(t.due || ''), t.done ? 'הושלמה' : 'פתוחה'])}</div>
    <div class="card"><h2>שעות (${d.time.length})</h2>${tbl([...d.time].reverse(), ['תאריך', 'פרויקט', 'תיאור', 'שעות', 'סכום', 'חויב'], (t) => [esc(t.date), esc(pn(d, t.project)), esc(t.desc), t.hours, money(t.hours * t.rate), t.invoice ? 'כן' : 'לא'])}</div>
    <div class="card"><h2>חשבוניות (${d.invoices.length})</h2>${tbl(d.invoices, ['מס׳', 'תאריך', 'לקוח', 'סכום', 'סטטוס'], (i) => [i.no, esc(i.date), esc(cn(d, i.client)), money(i.total), i.paid ? 'שולמה' : 'פתוחה'])}</div>
    <div class="card"><h2>אפיונים אישיים (${d.profiles.length})</h2>${tbl(d.profiles, ['שם', 'תפקיד', 'אופי', 'נוצר', 'פעולות בתוכנית'], (p) => [esc(p.name), esc(P_ROLES[p.role] || ''), esc(p.archetype), esc(new Date(p.createdAt).toLocaleDateString('he-IL')), p.plan.length])}</div>
    <div class="card"><h2>אבחונים (${d.diagnostics.length})</h2>${tbl(d.diagnostics, ['תאריך', 'לקוח', 'ציון כולל'], (g) => { const sc = scoreOf(g); return [esc(g.date), esc(cn(d, g.client)), Math.round(sc.reduce((x, y) => x + y.pct, 0) / sc.length) + '%']; })}</div>`;
  }
  const sums = list.map((w) => ({ w, ...ownerSummary(w) }));
  const all = sums.flatMap((s) => s.d.projects.map((p) => ({ owner: s.w, d: s.d, p })));
  const tot = (f) => sums.reduce((x, s) => x + f(s), 0);
  return `${head('')}<div class="grid" style="margin-top:12px">${stat(list.length, 'משתמשים')}${stat(all.length, 'פרויקטים בסך הכול')}${stat(tot((s) => s.openTasks), 'משימות פתוחות')}${stat(money(tot((s) => s.unbilled)), 'שעות שטרם חויבו')}${stat(money(tot((s) => s.openInv)), 'חשבוניות פתוחות')}</div>
  <div class="card" style="margin-top:16px"><h2>משתמשים</h2><div class="scroll"><table><tr><th>משתמש</th><th>לקוחות</th><th>פרויקטים פעילים</th><th>משימות פתוחות</th><th>שעות שטרם חויבו</th><th>עודכן</th><th></th></tr>
  ${sums.map((s) => `<tr><td>${esc(s.w.label)}</td><td>${s.d.clients.length}</td><td>${s.active}</td><td>${s.openTasks}</td><td>${money(s.unbilled)}</td><td>${s.w.updatedAt ? esc(new Date(s.w.updatedAt).toLocaleDateString('he-IL')) : '—'}</td><td><button class="sm pri" data-do="adminOpen" data-id="${esc(s.w.uid)}">פתח הכול</button></td></tr>`).join('')}</table></div></div>
  <div class="card"><h2>כל הפרויקטים (${all.length})</h2>${all.length ? `<div class="scroll"><table><tr><th>משתמש</th><th>פרויקט</th><th>לקוח</th><th>סטטוס</th><th>תקציב</th><th>שעות</th></tr>
  ${all.map(({ owner, d, p }) => `<tr><td>${esc(owner.label)}</td><td>${esc(p.name)}</td><td>${esc(cn(d, p.client))}</td><td><span class="tag ${p.status === 'פעיל' ? 'ok' : ''}">${esc(p.status)}</span></td><td>${money(p.budget)}</td><td>${d.time.filter((t) => t.project === p.id).reduce((x, t) => x + t.hours, 0)}</td></tr>`).join('')}</table></div>` : '<div class="empty">אין פרויקטים</div>'}</div>`;
}
async function loadAdmin() {
  if (loadAdmin.busy) return; loadAdmin.busy = true;
  const r = await Cloud.listWorkspaces(); loadAdmin.busy = false;
  adminData = r.ok ? { list: r.v.sort((x, y) => y.updatedAt - x.updatedAt) } : { error: r.error };
  if (curView() === 'admin') render();
}

/* ---------- הדרכה אינטראקטיבית ---------- */
/* מתחילה אוטומטית למשתמש חדש (בלי לקוחות ופרויקטים), וניתנת להפעלה מחדש בכפתור "הדרכה".
   שלבי פעולה מתקדמים לבד כשהמשתמש מבצע אותם; אפשר לדלג על כל שלב. הסטטוס נשמר ב-S.settings.tourDone (מסונכרן בענן). */
const curView = () => (location.hash || '#dashboard').slice(1);
const navTo = (v) => `a[href="#${v}"]`;
const TOUR = [
  { title: 'ברוכים הבאים ליועץ עסקי', text: 'הדרכה קצרה של כ-3 דקות: ניצור לקוח ופרויקט, נרשום שעות ונפיק חשבונית, ונכיר את האבחון, התחזית והשוק. אפשר לצאת בכל רגע.' },
  { go: 'dashboard', target: '#view .grid', title: 'לוח הבקרה', text: 'כאן רואים במבט אחד כמה לקוחות ופרויקטים פעילים, כמה שעות עוד לא חויבו, מה פתוח לגבייה ומה כבר שולם.' },
  { target: navTo('clients'), title: 'לקוחות ופרויקטים', text: 'כל מודול נמצא בלשונית משלו. לחץ על "לקוחות ופרויקטים".', done: () => curView() === 'clients' },
  { target: '[data-do=clientNew]', title: 'הוספת לקוח', text: 'לחץ על "+ לקוח", הקלד שם ושמור.', snap: () => S.clients.length, done: (b) => S.clients.length > b },
  { target: '[data-do=projectNew]', title: 'הוספת פרויקט', text: 'כל עבודה שייכת לפרויקט של לקוח. לחץ על "+ פרויקט", בחר את הלקוח ושמור.', snap: () => S.projects.length, done: (b) => S.projects.length > b },
  { target: navTo('tasks'), title: 'משימות', text: 'עכשיו למשימות. לחץ על לשונית "משימות".', done: () => curView() === 'tasks' },
  { target: '[data-do=taskNew]', title: 'משימה ראשונה', text: 'הוסף משימה עם תאריך יעד. את סדר העדיפויות קובעים בגרירה של ⠿, ואפשר לפרק משימה לתתי-משימות עם תאריכים משלהן (כפתור "+ תת"), גם הן ניתנות לגרירה. המשימות העליונות מופיעות גם בלוח הבקרה. משימות שעבר מועדן מסומנות באדום.', snap: () => S.tasks.length, done: (b) => S.tasks.length > b },
  { target: navTo('finance'), title: 'שעות וחשבוניות', text: 'לחץ על "שעות וחשבוניות".', done: () => curView() === 'finance' },
  { target: '[data-do=timeNew]', title: 'רישום שעות', text: 'לחץ על "+ שעות", בחר פרויקט, הזן שעות ותיאור. הסכום מחושב לפי התעריף השעתי.', snap: () => S.time.length, done: (b) => S.time.length > b },
  { target: '[data-do=invoiceMake]', title: 'הפקת חשבונית', text: 'הכפתור הזה מאחד את כל השעות שטרם חויבו לחשבונית לכל לקוח. לחץ עליו.', snap: () => S.invoices.length, done: (b) => S.invoices.length > b },
  { go: 'diagnostic', target: '[data-do=diagNew]', title: 'אבחון עסקי', text: 'שאלון של 20 שאלות ב-5 תחומים, וניתוח SWOT. הדוח מדרג כל תחום ומציע מה לשפר. מתאים לפגישת היכרות עם לקוח חדש.' },
  { go: 'profile', target: '[data-do=profNew]', title: 'אפיון אישי', text: 'שאלון קצר לכל שותף, מייסד או מטפל. בסופו מתקבלת תוכנית אישית ל-90 יום לפי התפקיד, החוזקות והמטרות, שאפשר להפוך למשימות עם תאריכים בלחיצה אחת.' },
  { go: 'plan', target: '[data-do=planEdit]', title: 'תוכנית ותחזית', text: 'משנים את ההנחות (הכנסה, צמיחה, הוצאות) והגרף והטבלה מתעדכנים: נקודת איזון, מתי נגמר המזומן ויתרה בסוף התקופה.' },
  { go: 'market', target: '[data-do=reqNew]', title: 'שוק ייעוץ', text: Cloud.enabled ? 'מפרסמים בקשה ומקבלים הצעות מחיר מיועצים אחרים, או מגישים הצעה לבקשות של אחרים. הצעות המחיר גלויות רק לבעל הבקשה ולמגיש.' : 'מפרסמים בקשה ומשווים הצעות מחיר. (במצב מקומי זו הדגמה; בגרסה המחוברת השוק משותף בין משתמשים.)' },
  { go: 'dashboard', title: 'סיימת!', text: 'לחיצה על "הדרכה" בפינה מפעילה אותה שוב בכל רגע. טיפים: רשום שעות מיד אחרי כל פגישה, והפק חשבונית פעם בשבוע; הרץ אבחון לכל לקוח חדש לפני הצעת מחיר.', last: true },
];
let tour = null; // { i, base }
const tourClear = () => document.querySelectorAll('.tour-ring, .tour-pop').forEach((e) => e.remove());
function tourStart() { tour = { i: 0, base: null }; tourEnter(); }
function tourFinish() {
  tour = null; tourClear();
  if (!S.settings.tourDone) { S.settings.tourDone = true; save(); }
}
function tourEnter() {
  const st = TOUR[tour.i]; if (!st) return tourFinish();
  tour.base = st.snap ? st.snap() : null; tour.adv = false;
  if (st.go && curView() !== st.go) { location.hash = '#' + st.go; return; } // hashchange מרנדר
  render();
}
function tourNext() { tour.i++; tour.i >= TOUR.length ? tourFinish() : tourEnter(); }
function tourBack() { if (tour.i > 0) { tour.i--; tourEnter(); } }
function tourRender() {
  tourClear();
  if (!tour) { // התחלה אוטומטית למשתמש חדש
    if (!tourAutoTried && !S.settings.tourDone && !S.clients.length && !S.projects.length) { tourAutoTried = true; tourStart(); }
    return;
  }
  const st = TOUR[tour.i];
  if (st.done && st.done(tour.base)) { if (!tour.adv) { tour.adv = true; setTimeout(() => tour && tourNext(), 350); } return; } // השלב הושלם בפעולת המשתמש
  if ($('#dlg').open) return; // טופס פתוח: מחכים לסגירתו
  const el = st.target ? document.querySelector(st.target) : null;
  const pop = document.createElement('div');
  pop.className = 'tour-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'הדרכה');
  const n = TOUR.length;
  pop.innerHTML = `<div class="tour-step">שלב ${tour.i + 1} מתוך ${n}</div><h3>${esc(st.title)}</h3><p>${esc(st.text)}</p>
  <div class="tour-bar"><i style="width:${Math.round(((tour.i + 1) / n) * 100)}%"></i></div>
  <div class="row">${st.done ? '<button data-do="tourNext">דלג על השלב</button>' : `<button class="pri" data-do="tourNext">${st.last ? 'סיום' : tour.i === 0 ? 'בוא נתחיל' : 'הבא'}</button>`}
  ${tour.i > 0 ? '<button data-do="tourBack">הקודם</button>' : ''}<button class="tour-x" data-do="tourFinish">${st.last ? '' : 'יציאה'}</button></div>`;
  document.body.append(pop);
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect(); const ring = document.createElement('div');
    ring.className = 'tour-ring'; Object.assign(ring.style, { top: r.top - 6 + 'px', left: r.left - 6 + 'px', width: r.width + 12 + 'px', height: r.height + 12 + 'px' });
    document.body.append(ring);
    const pr = pop.getBoundingClientRect(); const below = r.bottom + 12 + pr.height < innerHeight;
    pop.style.top = Math.max(8, below ? r.bottom + 12 : r.top - 12 - pr.height) + 'px';
    pop.style.left = Math.min(innerWidth - pr.width - 8, Math.max(8, r.left + r.width / 2 - pr.width / 2)) + 'px';
  } else { pop.classList.add('center'); }
  pop.querySelector('button.pri, button')?.focus({ preventScroll: true });
}
let tourAutoTried = false;
addEventListener('resize', () => { if (tour) tourRender(); });
addEventListener('keydown', (e) => { if (tour && e.key === 'Escape' && !$('#dlg').open) tourFinish(); });
$('#dlg').addEventListener('close', () => { if (tour) tourRender(); });

/* ---------- הפעלה ---------- */
if (Cloud.enabled) {
  window.addEventListener('pagehide', () => Cloud.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') Cloud.flush(); }); // מעבר לטאב אחר או נעילת מסך
  Cloud.init(async (user) => {
    if (!user) { me = null; isAdmin = false; adminData = null; adminUser = null; S = empty(); M = []; tour = null; tourAutoTried = false; Cloud.stopMarket(); loading = false; return render(); }
    me = user; loading = true; isAdmin = false; adminData = null; adminUser = null; render();
    try {
      let data = await Cloud.loadWorkspace(user.uid);
      if (!data) { // כניסה ראשונה: מעבירים נתונים שנשמרו מקומית בדפדפן הזה, אם יש
        data = readLocal() || {};
        if (Object.keys(data).length) { S = Object.assign(empty(), data); save(); try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
      }
      S = Object.assign(empty(), data);
      const pend = readPend(user.uid); // שינויים שנעשו ולא הספיקו להישמר (רענון או סגירה מהירה, או רשת שנפלה)
      if (pend && pend.ts > (Cloud.loadedAt || 0)) {
        S = Object.assign(empty(), pend.data); save();
        setTimeout(() => note('שוחזרו שינויים אחרונים שלא הספיקו להישמר בענן לפני שהדף נסגר, והם נשמרים עכשיו.'), 300);
      } else if (pend) { try { localStorage.removeItem(PEND + user.uid); } catch { /* ignore */ } }
      isAdmin = await Cloud.isAdmin(user.uid);
      Cloud.watchWorkspace(user.uid, (remote) => { S = Object.assign(empty(), remote); render(); });
      Cloud.watchRequests(user.uid, (list) => { M = list; if (location.hash === '#market') render(); });
    } catch (e) { note('שגיאה בטעינת הנתונים: ' + (e.message || e)); }
    loading = false; render();
  });
}
render();
