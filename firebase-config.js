/* הגדרות Firebase של הפרויקט (Project settings → General → Your apps → Web app → SDK setup and configuration).
   מפתח ה-API של Firebase הוא מזהה ציבורי ולא סוד; האבטחה נקבעת ב-firestore.rules.
   כל עוד הערך null האפליקציה פועלת במצב מקומי (localStorage), בלי התחברות. */
window.FIREBASE_CONFIG = null;
/* דוגמה (מעתיקים לשורה שמעל ומחליפים את הערכים):
   window.FIREBASE_CONFIG = {
  apiKey: 'AIza...',
  authDomain: 'YOUR-PROJECT.firebaseapp.com',
  projectId: 'YOUR-PROJECT',
  appId: '1:123456789:web:abcdef',
};
*/
