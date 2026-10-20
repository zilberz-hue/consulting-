'use strict';
/* שכבת Firebase: התחברות, סביבת עבודה אישית (workspaces/{uid}) ושוק ייעוץ משותף (requests/{id}/quotes/{consultantUid}).
   אם אין הגדרה, או שהדף נפתח כקובץ (file://), Cloud.enabled=false והאפליקציה פועלת מקומית. */
(function () {
  const cfg = window.FIREBASE_CONFIG;
  const enabled = !!(cfg && window.firebase && location.protocol !== 'file:');
  if (!enabled) { window.Cloud = { enabled: false }; return; }

  firebase.initializeApp(cfg);
  const auth = firebase.auth();
  const db = firebase.firestore();
  if (window.FIREBASE_EMULATOR) { auth.useEmulator('http://127.0.0.1:9099'); db.useEmulator('127.0.0.1', 8089); } // לבדיקות מקומיות בלבד
  const SESSION = Math.random().toString(36).slice(2);
  /* כניסה עם שם משתמש: Firebase מזהה לפי מייל, ולכן שם משתמש ממופה לכתובת פנימית שאינה נשלחת לשום מקום (.invalid) */
  const UDOM = '@username.invalid';
  const isUsername = (e) => (e || '').endsWith(UDOM);
  const toEmail = (v) => {
    v = (v || '').trim();
    if (v.includes('@')) return { email: v };
    const u = v.toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(u)) return { error: 'שם משתמש: 3 עד 30 תווים באנגלית, ספרות, נקודה, קו תחתון או מקף. אפשר גם להשתמש במייל.' };
    return { email: u + UDOM };
  };
  const userOf = (u) => {
    const e = u.email || ''; const local = e.split('@')[0];
    return { uid: u.uid, email: e, label: isUsername(e) ? local : e, name: u.displayName || local };
  };

  const ERR = {
    'auth/invalid-email': 'המייל או שם המשתמש אינם תקינים',
    'auth/missing-password': 'יש להזין סיסמה',
    'auth/weak-password': 'הסיסמה קצרה מדי (לפחות 6 תווים)',
    'auth/email-already-in-use': 'המייל או שם המשתמש כבר תפוסים',
    'auth/user-not-found': 'מייל / שם משתמש או סיסמה שגויים',
    'auth/wrong-password': 'מייל / שם משתמש או סיסמה שגויים',
    'auth/invalid-credential': 'מייל / שם משתמש או סיסמה שגויים',
    'auth/too-many-requests': 'יותר מדי ניסיונות. נסה שוב בעוד כמה דקות',
    'auth/popup-closed-by-user': 'החלון נסגר לפני סיום ההתחברות',
    'auth/unauthorized-domain': 'הדומיין הזה לא מורשה ב-Firebase (Authentication → Settings → Authorized domains)',
    'permission-denied': 'אין הרשאה לפעולה הזו',
  };
  const msg = (e) => ERR[e && e.code] || ('שגיאה: ' + ((e && e.message) || e));

  /* ----- התחברות ----- */
  const wrap = async (p) => { try { return { ok: true, v: await p }; } catch (e) { return { ok: false, error: msg(e) }; } };

  /* ----- סביבת עבודה אישית ----- */
  let wsUnsub = null; let timer = null; let pending = null;
  const wsRef = (uid) => db.collection('workspaces').doc(uid);

  async function write(uid, data, cb) {
    cb?.('saving');
    try {
      await wsRef(uid).set({ json: JSON.stringify(data), writer: SESSION, updatedAt: Date.now() });
      cb?.('saved');
    } catch (e) { cb?.('error', msg(e)); }
  }

  /* ----- שוק ----- */
  let reqUnsub = null; const quoteUnsubs = new Map(); const quotes = new Map(); let requests = [];

  function stopMarket() {
    reqUnsub?.(); reqUnsub = null;
    quoteUnsubs.forEach((u) => u()); quoteUnsubs.clear(); quotes.clear(); requests = [];
  }

  window.Cloud = {
    enabled: true,
    init(onUser) { auth.onAuthStateChanged((u) => onUser(u ? userOf(u) : null)); },
    signIn(id, pw) { const r = toEmail(id); return r.error ? Promise.resolve({ ok: false, error: r.error }) : wrap(auth.signInWithEmailAndPassword(r.email, pw)); },
    signUp(id, pw) { const r = toEmail(id); return r.error ? Promise.resolve({ ok: false, error: r.error }) : wrap(auth.createUserWithEmailAndPassword(r.email, pw)); },
    google: () => wrap(auth.signInWithPopup(new firebase.auth.GoogleAuthProvider())),
    reset(id) {
      if (!(id || '').includes('@')) return Promise.resolve({ ok: false, error: 'איפוס במייל זמין רק למי שנרשם עם מייל. למשתמש עם שם משתמש יש לבקש מהמנהל לאפס את הסיסמה.' });
      return wrap(auth.sendPasswordResetEmail(id.trim()));
    },
    signOut: async () => { await window.Cloud.flush(); stopMarket(); wsUnsub?.(); wsUnsub = null; return auth.signOut(); },

    async loadWorkspace(uid) {
      const snap = await wsRef(uid).get();
      return snap.exists ? JSON.parse(snap.data().json || '{}') : null;
    },
    /* שמירה מושהית; קריאות רצופות מתאחדות לכתיבה אחת */
    queueSave(uid, data, cb) {
      pending = { uid, data, cb }; cb?.('saving');
      clearTimeout(timer);
      timer = setTimeout(() => { const p = pending; pending = null; if (p) write(p.uid, p.data, p.cb); }, 600);
    },
    async flush() {
      clearTimeout(timer);
      const p = pending; pending = null;
      if (p) await write(p.uid, p.data, p.cb);
    },
    /* סנכרון חי בין מכשירים; מתעלם מהכתיבות של הסשן הזה */
    watchWorkspace(uid, onRemote) {
      wsUnsub?.();
      wsUnsub = wsRef(uid).onSnapshot((snap) => {
        if (!snap.exists || snap.metadata.hasPendingWrites) return;
        const d = snap.data(); if (d.writer === SESSION) return;
        try { onRemote(JSON.parse(d.json || '{}')); } catch { /* מסמך פגום, מתעלמים */ }
      });
    },

    watchRequests(uid, onChange) {
      stopMarket();
      const emit = () => onChange(requests.map((r) => ({ ...r, quotes: quotes.get(r.id) || [] })));
      const attach = (r) => {
        if (quoteUnsubs.has(r.id)) return;
        const col = db.collection('requests').doc(r.id).collection('quotes');
        const fail = () => { // הכללים בודקים את מסמך הבקשה בשרת; אם הוא עוד לא נשמר, מנסים שוב
          quoteUnsubs.get(r.id)?.(); quoteUnsubs.delete(r.id);
          setTimeout(() => { if (reqUnsub && requests.some((x) => x.id === r.id)) attach(r); }, 2500);
        };
        const mineReq = r.ownerUid === uid;
        quoteUnsubs.set(r.id, mineReq
          ? col.onSnapshot((s) => { quotes.set(r.id, s.docs.map((d) => ({ id: d.id, ...d.data() }))); emit(); }, fail)
          : col.doc(uid).onSnapshot((s) => { quotes.set(r.id, s.exists ? [{ id: s.id, ...s.data() }] : []); emit(); }, fail));
      };
      reqUnsub = db.collection('requests').orderBy('createdAt', 'desc').limit(100).onSnapshot({ includeMetadataChanges: true }, (snap) => {
        requests = snap.docs.map((d) => ({ id: d.id, pending: d.metadata.hasPendingWrites, ...d.data() }));
        const ids = new Set(requests.map((r) => r.id));
        quoteUnsubs.forEach((u, id) => { if (!ids.has(id)) { u(); quoteUnsubs.delete(id); quotes.delete(id); } });
        requests.forEach((r) => { if (!r.pending) attach(r); }); // בקשה שעוד לא נשמרה בשרת: מחכים לאישור
        emit();
      }, () => onChange([]));
    },
    stopMarket,
    createRequest: (user, r) => wrap(db.collection('requests').add({
      ownerUid: user.uid, ownerName: user.name, title: r.title, area: r.area, budget: r.budget, desc: r.desc,
      clientLabel: r.clientLabel || user.name, accepted: null, createdAt: Date.now(),
    })),
    async deleteRequest(id) {
      return wrap((async () => {
        const ref = db.collection('requests').doc(id);
        const qs = await ref.collection('quotes').get();
        await Promise.all(qs.docs.map((d) => d.ref.delete()));
        await ref.delete();
      })());
    },
    submitQuote: (user, rid, q) => wrap(db.collection('requests').doc(rid).collection('quotes').doc(user.uid).set({
      consultantUid: user.uid, consultant: q.consultant, price: q.price, days: q.days, msg: q.msg, updatedAt: Date.now(),
    })),
    withdrawQuote: (user, rid) => wrap(db.collection('requests').doc(rid).collection('quotes').doc(user.uid).delete()),
    acceptQuote: (rid, consultantUid) => wrap(db.collection('requests').doc(rid).update({ accepted: consultantUid })),
  };
})();
