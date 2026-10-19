"""Builds the deployable single-file pages. Run: python3 build.py

  dist/index.html   -> Firebase Hosting / any static host (cloud mode if firebase-config.js is filled in)
  standalone.html   -> same file, handy to open or drag into a static host
  artifact.html     -> local-only build (no Firebase), for sandboxed previews
"""
import base64, os, re

read = lambda p: open(p, encoding='utf-8').read()
css, js, cloud, cfg = read('styles.css'), read('app.js'), read('cloud.js'), read('firebase-config.js')
logo = base64.b64encode(open('logo.png', 'rb').read()).decode()
has_cfg = bool(re.search(r'^window\.FIREBASE_CONFIG\s*=\s*\{', cfg, re.M))
SDK = ''.join(f'<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-{n}-compat.js"></script>\n'
              for n in ('app', 'auth', 'firestore'))

body_html = f'''<header class="top"><strong class="brand"><img class="logo" alt="TizonHealth" src="data:image/png;base64,{logo}"><span>סוויטת ייעוץ עסקי<small>The Architecture of Vitality</small></span></strong><nav id="nav"></nav></header>
<main id="view"></main>
<dialog id="dlg"></dialog>'''

def page(with_cloud):
    scripts = ''
    if with_cloud and has_cfg:
        scripts += SDK + f'<script>\n{cfg}\n</script>\n<script>\n{cloud}\n</script>\n'
    scripts += f'<script>\n{js}\n</script>\n'
    return f'<style>\n{css}\n</style>\n{body_html}\n{scripts}'

def full(inner):
    return ('<!doctype html>\n<html lang="he" dir="rtl">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>סוויטת ייעוץ עסקי</title>\n</head>\n<body>\n'
            + inner + '</body>\n</html>\n')

os.makedirs('dist', exist_ok=True)
html = full(page(True))
open('dist/index.html', 'w', encoding='utf-8').write(html)
open('standalone.html', 'w', encoding='utf-8').write(html)
open('artifact.html', 'w', encoding='utf-8').write('<title>סוויטת ייעוץ עסקי</title>\n' + page(False))
print('cloud mode:', 'on' if has_cfg else 'off (firebase-config.js is empty)')
