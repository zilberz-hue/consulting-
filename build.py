"""Builds standalone.html (single file, logo inlined). Run: python3 build.py"""
import base64
css = open('styles.css', encoding='utf-8').read()
js = open('app.js', encoding='utf-8').read()
logo = base64.b64encode(open('logo.png', 'rb').read()).decode()
head = f'''<header class="top"><strong class="brand"><img class="logo" alt="TizonHealth" src="data:image/png;base64,{logo}"><span>סוויטת ייעוץ עסקי<small>The Architecture of Vitality</small></span></strong><nav id="nav"></nav></header>
<main id="view"></main>
<dialog id="dlg"></dialog>'''
body = f'<style>\n{css}\n</style>\n{head}\n<script>\n{js}\n</script>\n'
open('standalone.html', 'w', encoding='utf-8').write(
    '<!doctype html>\n<html lang="he" dir="rtl">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>סוויטת ייעוץ עסקי</title>\n</head>\n<body>\n' + body + '</body>\n</html>\n')
open('artifact.html', 'w', encoding='utf-8').write('<title>סוויטת ייעוץ עסקי</title>\n' + body)
