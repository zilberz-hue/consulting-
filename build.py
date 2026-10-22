"""Builds the deployable single-file pages. Run: python3 build.py

  dist/index.html   -> Firebase Hosting / any static host (cloud mode if firebase-config.js is filled in)
  standalone.html   -> same file, handy to open or drag into a static host
  artifact.html     -> local-only build (no Firebase), for sandboxed previews
"""
import base64, os, re, shutil

read = lambda p: open(p, encoding='utf-8').read()
css, js, cloud, cfg = read('styles.css'), read('app.js'), read('cloud.js'), read('firebase-config.js')
logo = base64.b64encode(open('logo.png', 'rb').read()).decode()
has_cfg = bool(re.search(r'^window\.FIREBASE_CONFIG\s*=\s*\{', cfg, re.M))
SDK_NAMES = ('app', 'auth', 'firestore')
# בקובץ שעולה לאתר ה-SDK מוגש מאותו דומיין (vendor/), כי ברשתות מסוננות הבקשה ל-gstatic נתקעת ומשאירה דף לבן
SDK_LOCAL = ''.join(f'<script src="vendor/firebase-{n}-compat.js?v=10.14.1"></script>\n' for n in SDK_NAMES)
SDK_CDN = ''.join(f'<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-{n}-compat.js"></script>\n' for n in SDK_NAMES)
# רץ לפני כל השאר: אם האתר לא עלה תוך זמן סביר, או שנזרקה שגיאה, מציג הודעה במקום דף ריק
BOOT = '''<script>
(function(){function show(msg){var b=document.getElementById('boot');if(!b)return;b.innerHTML='<b>האתר לא הצליח להיטען.</b><br>'+msg+'<br><br><button onclick="location.reload()">טען מחדש</button>';}
window.addEventListener('error',function(e){show('פרטים לתמיכה: '+String((e&&e.message)||(e&&e.target&&e.target.src)||'שגיאה').replace(/[<>&]/g,''));},true);
setTimeout(function(){show('ייתכן שסינון אינטרנט, אנטי-וירוס או חיבור איטי חוסמים את הטעינה. נסו לרענן, או לפתוח מרשת אחרת (למשל אינטרנט סלולרי).');},20000);})();
</script>
'''

body_html = f'''<header class="top"><strong class="brand"><img class="logo" alt="TizonHealth" src="data:image/png;base64,{logo}"><span>טייזון – היועץ העסקי שלך<small>The Architecture of Vitality</small></span></strong><nav id="nav"></nav></header>
<main id="view"><div class="card empty" id="boot">טוען…</div></main>
<dialog id="dlg"></dialog>'''

def page(with_cloud, sdk=SDK_CDN):
    scripts = BOOT
    if with_cloud and has_cfg:
        scripts += sdk + f'<script>\n{cfg}\n</script>\n<script>\n{cloud}\n</script>\n'
    scripts += f'<script>\n{js}\n</script>\n'
    return f'<style>\n{css}\n</style>\n{body_html}\n{scripts}'

def full(inner):
    return ('<!doctype html>\n<html lang="he" dir="rtl">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>טייזון – היועץ העסקי שלך</title>\n</head>\n<body>\n'
            + inner + '</body>\n</html>\n')

os.makedirs('dist/vendor', exist_ok=True)
for n in SDK_NAMES:
    shutil.copy(f'vendor/firebase-{n}-compat.js', 'dist/vendor/')
open('dist/index.html', 'w', encoding='utf-8').write(full(page(True, SDK_LOCAL)))
html = full(page(True))
open('standalone.html', 'w', encoding='utf-8').write(html)
open('index.html', 'w', encoding='utf-8').write(html)  # גם בשורש הריפו, כדי שכל העותקים יהיו זהים
open('artifact.html', 'w', encoding='utf-8').write('<title>טייזון – היועץ העסקי שלך</title>\n' + page(False))
print('cloud mode:', 'on' if has_cfg else 'off (firebase-config.js is empty)')
