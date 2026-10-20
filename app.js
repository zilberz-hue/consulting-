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
  diagnostics: [], requests: [],
  plan: { cash: 50000, revenue: 30000, growth: 3, cogs: 35, fixed: 18000, months: 12 },
  settings: { rate: 400 },
});
let S;
const readLocal = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
S = Cloud.enabled ? empty() : Object.assign(empty(), readLocal() || {});
const privateState = () => { const { requests, ...rest } = S; return rest; };
const setSaveState = (st, err) => {
  const el = $('#sv'); if (!el) return;
  el.textContent = st === 'saving' ? 'שומר…' : st === 'saved' ? 'נשמר ✓' : 'שגיאת שמירה';
  el.title = err || ''; el.style.color = st === 'error' ? 'var(--bad)' : '';
};
const save = () => {
  if (Cloud.enabled) { if (me) Cloud.queueSave(me.uid, privateState(), setSaveState); return; }
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
  const who = `<span class="who">${Cloud.enabled ? `${esc(me.label)} · <small id="sv"></small> ` : ''}${help}${Cloud.enabled ? ' <button class="sm" data-do="logout">יציאה</button>' : ''}</span>`;
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
  </div><div class="card" style="margin-top:16px"><h2>משימות בעדיפות עליונה</h2>${due.length ? `<table>${due.map((t) => `<tr><td>${esc(t.title)}</td><td class="muted">${esc(projectName(t.project))}</td><td>${esc(t.due || '')}</td></tr>`).join('')}</table>` : '<div class="empty">אין משימות פתוחות</div>'}</div>
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
/* סדר המשימות במערך S.tasks הוא סדר העדיפות: למעלה = הכי דחוף. המשימות שהושלמו יורדות לסוף. */
const openTasks = () => S.tasks.filter((t) => !t.done);
function tasks() {
  const open = openTasks(); const done = S.tasks.filter((t) => t.done);
  const row = (t, rank) => `<tr data-task="${t.id}" ${t.done ? '' : 'data-open'}>
    <td class="handle" ${t.done ? '' : 'data-handle title="גרור כדי לשנות עדיפות" aria-hidden="true"'}>${t.done ? '' : '⠿'}</td>
    <td class="rank">${t.done ? '' : '#' + rank}</td>
    <td style="width:30px"><input type="checkbox" aria-label="סמן כהושלמה" ${t.done ? 'checked' : ''} data-do="taskToggle" data-id="${t.id}"></td>
    <td style="${t.done ? 'text-decoration:line-through;color:var(--mut)' : ''}">${esc(t.title)}</td><td class="muted">${esc(projectName(t.project))}</td>
    <td>${t.due && !t.done && t.due < today() ? `<span class="tag bad">${esc(t.due)}</span>` : esc(t.due || '')}</td>
    <td class="nowrap">${t.done ? '' : `<button class="sm" data-do="taskUp" data-id="${t.id}" aria-label="העלה בעדיפות" title="העלה בעדיפות">▲</button> <button class="sm" data-do="taskDown" data-id="${t.id}" aria-label="הורד בעדיפות" title="הורד בעדיפות">▼</button> `}${edit('task', t.id)}</td></tr>`;
  return `<h1>משימות</h1><div class="card"><div class="bar"><span class="muted">${open.length} פתוחות · גרור את ⠿ כדי לתעדף, הדחופה ביותר למעלה</span>
  <span><button data-do="taskSort" title="סדר מחדש לפי תאריך יעד">מיין לפי תאריך</button> <button class="pri" data-do="taskNew">+ משימה</button></span></div>
  ${S.tasks.length ? `<div class="scroll"><table><tbody id="tl">${open.map((t, i) => row(t, i + 1)).join('')}${done.map((t) => row(t)).join('')}</tbody></table></div>` : '<div class="empty">אין משימות</div>'}</div>`;
}
/* גרירה בעכבר ובמגע (pointer events) */
let drag = null;
document.addEventListener('pointerdown', (ev) => {
  const h = ev.target.closest('[data-handle]'); if (!h || ev.button > 0) return;
  const row = h.closest('tr'); ev.preventDefault();
  h.setPointerCapture(ev.pointerId); row.classList.add('dragging'); drag = { row, tb: row.parentElement, id: ev.pointerId };
});
document.addEventListener('pointermove', (ev) => {
  if (!drag || ev.pointerId !== drag.id) return;
  const rows = [...drag.tb.querySelectorAll('tr[data-open]')].filter((r) => r !== drag.row);
  const before = rows.find((r) => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
  if (before) drag.tb.insertBefore(drag.row, before); else if (rows.length) rows[rows.length - 1].after(drag.row);
  if (ev.clientY < 70) scrollBy(0, -14); else if (ev.clientY > innerHeight - 70) scrollBy(0, 14);
});
const endDrag = (ev) => {
  if (!drag || ev.pointerId !== drag.id) return;
  drag.row.classList.remove('dragging');
  const ids = [...drag.tb.querySelectorAll('tr[data-open]')].map((r) => r.dataset.task); drag = null;
  setTasksOrder(ids);
};
document.addEventListener('pointerup', endDrag); document.addEventListener('pointercancel', endDrag);
function setTasksOrder(ids) {
  const open = ids.map((id) => by(S.tasks, id)).filter(Boolean);
  S.tasks = [...open, ...S.tasks.filter((t) => t.done || !open.includes(t))];
  save(); render();
}
function moveTask(id, d) {
  const ids = openTasks().map((t) => t.id); const i = ids.indexOf(id); const j = i + d;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]]; setTasksOrder(ids);
  document.querySelector(`[data-do="${d < 0 ? 'taskUp' : 'taskDown'}"][data-id="${id}"]`)?.focus(); // ממשיכים להזיז במקלדת
}
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
  taskNew: () => form('משימה חדשה', TASK_F(), null, (v) => { if (v.title) S.tasks.push({ id: uid(), done: false, ...v }); }),
  taskEdit: (id) => form('עריכת משימה', TASK_F(), by(S.tasks, id), (v) => Object.assign(by(S.tasks, id), v)),
  taskDel: (id) => delFrom(S.tasks, id),
  taskUp: (id) => moveTask(id, -1),
  taskDown: (id) => moveTask(id, 1),
  taskSort: () => setTasksOrder(openTasks().sort((a, b) => (a.due || '9').localeCompare(b.due || '9')).map((t) => t.id)),
  taskToggle: (id) => { const t = by(S.tasks, id); t.done = !t.done; save(); render(); },
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
  { target: '[data-do=taskNew]', title: 'משימה ראשונה', text: 'הוסף משימה עם תאריך יעד. את סדר העדיפויות קובעים בגרירה של ⠿ (או בחיצים), והמשימות העליונות מופיעות גם בלוח הבקרה. משימות שעבר מועדן מסומנות באדום.', snap: () => S.tasks.length, done: (b) => S.tasks.length > b },
  { target: navTo('finance'), title: 'שעות וחשבוניות', text: 'לחץ על "שעות וחשבוניות".', done: () => curView() === 'finance' },
  { target: '[data-do=timeNew]', title: 'רישום שעות', text: 'לחץ על "+ שעות", בחר פרויקט, הזן שעות ותיאור. הסכום מחושב לפי התעריף השעתי.', snap: () => S.time.length, done: (b) => S.time.length > b },
  { target: '[data-do=invoiceMake]', title: 'הפקת חשבונית', text: 'הכפתור הזה מאחד את כל השעות שטרם חויבו לחשבונית לכל לקוח. לחץ עליו.', snap: () => S.invoices.length, done: (b) => S.invoices.length > b },
  { go: 'diagnostic', target: '[data-do=diagNew]', title: 'אבחון עסקי', text: 'שאלון של 20 שאלות ב-5 תחומים, וניתוח SWOT. הדוח מדרג כל תחום ומציע מה לשפר. מתאים לפגישת היכרות עם לקוח חדש.' },
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
      isAdmin = await Cloud.isAdmin(user.uid);
      Cloud.watchWorkspace(user.uid, (remote) => { S = Object.assign(empty(), remote); render(); });
      Cloud.watchRequests(user.uid, (list) => { M = list; if (location.hash === '#market') render(); });
    } catch (e) { note('שגיאה בטעינת הנתונים: ' + (e.message || e)); }
    loading = false; render();
  });
}
render();
