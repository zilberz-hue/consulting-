# יועץ עסקי

תוכנה בעברית (RTL) למשרד ייעוץ עסקי. בלי build framework: HTML/JS/CSS סטטיים, ו-Firebase להתחברות ולשמירה בענן.

| מצב | מתי | מה יש |
|---|---|---|
| **מקומי** | `firebase-config.js` ריק (ברירת מחדל), או פתיחה כקובץ `file://` | הכול נשמר ב-localStorage, בלי התחברות. שוק הייעוץ הוא הדגמה. |
| **ענן** | `firebase-config.js` מלא | התחברות (מייל+סיסמה / Google), שמירה וסנכרון חי בין מכשירים, שוק ייעוץ משותף בין משתמשים. |

## מודולים
1. **ניהול משרד** – לקוחות, פרויקטים, משימות, רישום שעות וחשבוניות.
2. **אבחון עסקי** – שאלון 20 שאלות, SWOT, דוח והמלצות.
3. **תוכנית ותחזית** – תזרים 1–36 חודשים, נקודת איזון, גרף, CSV.
4. **שוק ייעוץ** – בקשות והצעות מחיר. בענן: הצעות המחיר גלויות רק לבעל הבקשה ולמגיש.

## הפעלת Firebase (חד-פעמי)
> **פרויקט חדש ונפרד.** אל תשתמש בפרויקט של Rate Desk (`loanbid`): `firebase deploy` של הכללים יחליף את הכללים שלו.

1. ב-[console.firebase.google.com](https://console.firebase.google.com) צור פרויקט, והוסף **Web app**.
2. **Build → Authentication → Sign-in method**: הפעל *Email/Password* ו-*Google*.
   **Settings → Authorized domains**: הוסף את הדומיין שבו האתר יעלה.
3. **Build → Firestore Database**: צור מסד נתונים (מצב production).
4. העתק את הגדרות ה-Web app (`apiKey`, `authDomain`, `projectId`, `appId`) אל `firebase-config.js`. אלה מזהים ציבוריים, לא סודות.
5. בנה ופרוס:
   ```bash
   npm i -g firebase-tools && firebase login
   firebase use --add            # בחר את הפרויקט
   python3 build.py              # מייצר dist/index.html
   firebase deploy --only firestore:rules,hosting
   ```
   אפשר גם לפרוס את `dist/index.html` לכל אחסון סטטי (Netlify וכד'). הכללים חייבים לעלות דרך `firebase deploy --only firestore:rules`.

Google Sign-In והתחברות בכלל לא עובדים מ-`file://`; יש להגיש את האתר ב-https או ב-`localhost`.

## מבנה הנתונים ואבטחה (`firestore.rules`)
- `workspaces/{uid}` – כל נתוני המשרד של המשתמש (JSON אחד, עד ~900KB). רק הבעלים קורא וכותב.
- `requests/{id}` – בקשת ייעוץ. כל משתמש מחובר קורא; הבעלים יוצר ורשאי רק לסמן `accepted`.
- `requests/{id}/quotes/{consultantUid}` – הצעת מחיר אחת לכל יועץ. נקראת רק ע"י בעל הבקשה והיועץ עצמו; אי אפשר להגיש הצעה לבקשה של עצמך או אחרי שנבחרה הצעה.

נבדק מול Firestore Emulator: 32 בדיקות כללים (בעלות, זיוף זהות, הפרדת הצעות מחיר, שדות לא חוקיים) ובדיקת קצה-לקצה בדפדפן עם שני משתמשים (הרשמה, שמירה אחרי רענון, סנכרון בין מכשירים, פרסום בקשה, הגשה ואישור הצעה, מחיקה).

## מגבלות ידועות
- סנכרון בין מכשירים הוא "הכותב האחרון מנצח" על כל מסמך המשרד. עריכה בו-זמנית באותו פריט משני מכשירים תדרוס.
- מחיקת בקשה מוחקת את ההצעות שעליה מהצד של הלקוח; אם החיבור נופל באמצע, ייתכנו הצעות יתומות (לא נגישות לאיש).
- אין התראות מייל על הצעה חדשה או על בחירה בהצעה.
- החשבונית היא מסמך הדגמה, לא חשבונית מס רשמית.

## קבצים
`index.html` + `app.js` + `cloud.js` + `styles.css` (קוד), `firebase-config.js` (הגדרה), `firestore.rules`, `firebase.json`, `build.py` (מרכיב `dist/index.html`, `standalone.html` ו-`artifact.html` בלי ענן), `logo.png`.
