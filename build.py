"""Mathematical Library: turn Markdown notes into navigable, block-editable static HTML.

Requires Python 3 and Pandoc. Run `python build.py`.
"""
from __future__ import annotations
import html, json, re, subprocess, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NOTES = ROOT / 'notes'
OUT = ROOT / 'articles'
ASSET = ROOT / 'assets'
MARKER_RE = re.compile(r'^<!-- ml:block:([a-zA-Z0-9_-]+) -->\s*\n', re.M)


def slugify(s: str) -> str:
    s = re.sub(r'[^a-zA-Z0-9-]+', '-', s.lower()).strip('-')
    return s or ('article-' + uuid.uuid4().hex[:8])


def split_unmarked(text: str) -> list[str]:
    """Paragraph-like blocks; fenced divs remain one editable block."""
    lines = text.strip().splitlines(keepends=True)
    chunks, current, fenced = [], [], 0
    def flush():
        nonlocal current
        s = ''.join(current).strip()
        if s: chunks.append(s)
        current = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith(':::'):
            if fenced == 0:
                flush()
                fenced = 1
            elif stripped == ':::':
                fenced -= 1
            else:
                fenced += 1
            current.append(line)
            if fenced == 0: flush()
            continue
        if fenced:
            current.append(line)
        elif stripped == '':
            flush()
        elif re.match(r'^#{1,6} ', stripped):
            flush(); current.append(line); flush()
        else:
            current.append(line)
    flush()
    return chunks


def annotate_if_needed(path: Path) -> list[dict]:
    text = path.read_text(encoding='utf-8')
    matches = list(MARKER_RE.finditer(text))
    if matches:
        if text[:matches[0].start()].strip():
            raise ValueError(f'Unmarked source preceding first block in {path}')
        return [dict(id=m.group(1), source=text[m.end():(matches[i+1].start() if i+1 < len(matches) else len(text))].strip())
                for i,m in enumerate(matches)]
    chunks = split_unmarked(text)
    result = [dict(id='b' + str(i+1).zfill(3), source=x) for i,x in enumerate(chunks)]
    path.write_text(''.join(f'<!-- ml:block:{b["id"]} -->\n{b["source"]}\n\n' for b in result), encoding='utf-8')
    return result


def pandoc(source: str) -> str:
    p = subprocess.run(['pandoc', '-f', 'markdown+tex_math_dollars+fenced_divs-raw_html+auto_identifiers',
                        '-t','html5','--mathjax','--wrap=none'], input=source, text=True,
                       capture_output=True, check=True)
    return p.stdout.strip()


def fold_proof(markup: str) -> str:
    if not re.match(r'<div\b[^>]*\bclass="[^"]*\bproof\b', markup): return markup
    first = markup.find('>') + 1
    last = markup.rfind('</div>')
    if last < first: return markup
    inner = markup[first:last]
    return ('<details class="proof-fold lemma-fold" open>'
            '<summary class="proof-fold-summary"><span class="proof-fold-title">Доказательство</span>'
            '<span class="proof-fold-toggle"><span class="when-open">Скрыть доказательство</span>'
            '<span class="when-closed">Показать доказательство</span>'
            '<span class="fold-chevron" aria-hidden="true"></span></span></summary>'
            '<div class="proof-fold-body">' + inner + '</div></details>')


def block_html(block: dict) -> str:
    rendered = fold_proof(pandoc(block['source']))
    return (f'<div class="editable-block" data-block-id="{block["id"]}" id="block-{block["id"]}">'
            '<div class="block-tools" aria-label="Редактирование блока">'
            f'<button type="button" data-edit-block="{block["id"]}" title="Редактировать этот блок">✎ Изменить</button>'
            f'<button type="button" data-add-after="{block["id"]}" title="Вставить блок после этого">＋</button>'
            f'<button type="button" data-copy-link="{block["id"]}" title="Скопировать ссылку на блок">↗</button>'
            '</div>' + rendered + '</div>')


def js_json(value) -> str:
    return json.dumps(value, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')


def page(title: str, body: str, base: str = '') -> str:
    css = (ASSET/'styles.css').read_text(encoding='utf-8')
    return f'''<!DOCTYPE html><html lang="ru" data-theme="light"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#fbfaf7"><meta name="robots" content="noindex,nofollow"><title>{html.escape(title)} · Mathematical Library</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;650;700&family=STIX+Two+Text:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>{css}</style>
<script>window.MathJax={{tex:{{inlineMath:[['$','$'],['\\\\(','\\\\)']],displayMath:[['$$','$$'],['\\\\[','\\\\]']],tags:'ams',packages:{{'[+]':['ams']}}}},options:{{skipHtmlTags:['script','noscript','style','textarea','pre','code']}},svg:{{fontCache:'local',scale:1}}}};</script>
<script defer src="{base}assets/vendor/mathjax-tex-svg.js"></script>
<script defer src="{base}assets/site.js"></script>
<script defer src="{base}assets/editor.js"></script>
</head><body>
<div class="progress" aria-hidden="true"></div>
<header class="site-header"><a class="brand" href="{base}index.html"><span class="brand-mark">M</span><span class="brand-text">Mathematical Library</span><span class="brand-sub">/ essays</span></a>
<nav class="header-nav"><a href="{base}index.html">Библиотека</a><button type="button" class="icon-btn" data-theme-toggle aria-label="Тёмная тема">☾</button><button class="icon-btn mobile-nav-btn" type="button" data-nav-toggle aria-label="Содержание">☰</button></nav></header>
{body}
<footer class="page-footer"><span>Mathematical Library · prototype editor</span><span>Editing: Ctrl+Shift+E or ?edit=1</span></footer>
<!-- Editor stays invisible in reading mode. No GitHub token is stored in the website. -->
<div id="edit-toolbar" hidden><span class="editor-pill">✎ Режим редактирования</span><button type="button" data-action="new-article">＋ Статья</button><button type="button" data-action="connect">GitHub</button><button type="button" data-action="exit-edit">Готово</button></div>
<dialog id="edit-dialog"><form method="dialog" id="edit-form"><div class="editor-modal-head"><h2 id="edit-dialog-title">Edit block</h2><button type="button" class="x-close" data-action="close-dialog" aria-label="Закрыть">×</button></div><p id="edit-hint"></p><label for="edit-source">Математический исходный текст (Markdown + LaTeX)</label><textarea id="edit-source" spellcheck="false" rows="13"></textarea><p class="editor-preview-label">Предпросмотр (упрощённый; окончательный HTML строится Pandoc)</p><div id="edit-preview" class="article-body" aria-live="polite"></div><p id="edit-error" role="status"></p><div class="editor-actions"><button type="button" data-action="save-draft">Сохранить черновик</button><button type="button" class="primary-editor" data-action="publish">Опубликовать в GitHub</button></div></form></dialog>
<dialog id="new-dialog"><div class="editor-modal-head"><h2>Новая статья</h2><button type="button" class="x-close" data-action="close-dialog">×</button></div><label for="new-title">Название</label><input id="new-title" placeholder="Например, Концы групп"><label for="new-slug">Адрес (латиницей)</label><input id="new-slug" placeholder="ends-of-groups"><label for="new-category">Раздел</label><input id="new-category" value="Geometry"/><p id="new-error" role="status"></p><div class="editor-actions"><button type="button" data-action="create-local">Создать черновик</button><button class="primary-editor" type="button" data-action="create-publish">Создать и опубликовать</button></div></dialog>
<dialog id="connect-dialog"><div class="editor-modal-head"><h2>Подключение GitHub</h2><button type="button" class="x-close" data-action="close-dialog">×</button></div><p>Для публикации укажите свой репозиторий и fine-grained access token с правом <b>Contents: Read and write</b> только для этого репозитория.</p><label for="gh-owner">GitHub username</label><input id="gh-owner" autocomplete="username"><label for="gh-repo">Имя репозитория</label><input id="gh-repo" value="math-library"><label for="gh-branch">Ветка</label><input id="gh-branch" value="main"><label for="gh-token">Token — используется только в текущей вкладке, не сохраняется</label><input id="gh-token" type="password" autocomplete="off"><p id="connect-error" role="status"></p><div class="editor-actions"><button type="button" data-action="clear-token">Отключить</button><button class="primary-editor" type="button" data-action="save-connection">Подключить</button></div></dialog>
</body></html>'''


def build_article(slug: str, blocks: list[dict], records: list[dict]) -> None:
    title = re.sub(r'^#\s+', '', blocks[0]['source'].splitlines()[0]).strip() if blocks else slug
    category = 'Математические заметки'
    # First block is heading, second is subtitle when one is present.
    h2, h3, title_html = [], [], []
    result = []
    in_fold = False
    for b in blocks:
        source = b['source']; m = re.match(r'^#{2,3} (.+)$', source.strip())
        if m and source.startswith('## '):
            if in_fold:
                result.append('</div></details>')
                in_fold = False
        rendered = block_html(b)
        result.append(rendered)
        if m:
            plain = re.sub(r'\$[^$]*\$', '', m.group(1)).strip() or 'Раздел'
            target = f'block-{b["id"]}'
            (h2 if source.startswith('## ') else h3).append((target, plain))
        if m and source.startswith('## ') and (m.group(1).startswith('1.') or m.group(1).startswith('2.')):
            foldtitle = 'Алгебраическое доказательство' if m.group(1).startswith('1.') else 'Геометрическое доказательство'
            result.append('<details class="proof-fold section-fold" open><summary class="proof-fold-summary"><span class="proof-fold-title">' + foldtitle + '</span><span class="proof-fold-toggle"><span class="when-open">Скрыть доказательство</span><span class="when-closed">Показать доказательство</span><span class="fold-chevron"></span></span></summary><div class="proof-fold-body">')
            in_fold = True
    if in_fold: result.append('</div></details>')
    toc = ''.join(f'<a href="#{target}" class="level-2">{html.escape(name)}</a>' for target,name in h2)
    raw_data = {'slug':slug,'title':title,'category':category,'path':f'notes/{slug}.md','blocks':blocks}
    page_body = f'''<div class="article-grid">
<aside class="left-rail"><div class="left-rail-sticky"><div class="rail-title">В библиотеке</div><a class="rail-link" href="../index.html">← К каталогу</a><a class="rail-link selected" href="{slug}.html">{html.escape(title)}</a></div></aside>
<main class="main-column"><div class="breadcrumb"><a href="../index.html">Библиотека</a><span class="sep">/</span>{category}</div><div class="article-meta">Математический очерк · Рабочая версия</div><div class="article-body article-editable" id="article-content">{''.join(result)}</div><div class="article-bottom"><a href="../notes/{slug}.md">Исходный Markdown</a></div></main>
<aside class="right-rail"><div class="right-rail-sticky"><div class="rail-title">На этой странице</div><nav class="right-toc">{toc}</nav></div></aside></div>
<script id="ml-article-data" type="application/json">{js_json(raw_data)}</script>'''
    (OUT/f'{slug}.html').write_text(page(title,page_body,'../'),encoding='utf-8')
    records.append({'slug':slug,'title':title,'category':category})


def build_home(records: list[dict]) -> None:
    entries=[]
    for i,r in enumerate(records,1):
        entries.append(f'<div class="essay-entry"><div><h2 class="essay-title"><a href="articles/{r["slug"]}.html">{html.escape(r["title"])}</a></h2><p class="essay-desc">Развёрнутый математический текст · {html.escape(r["category"])}</p></div><div class="essay-index">{i:02}</div></div>')
    body = '<main class="landing"><div class="eyebrow">A personal collection of mathematics</div><h1>Mathematics, collected.</h1><p class="landing-intro">Развёрнутые заметки о математических идеях, доказательствах и связях между ними.</p><hr class="landing-rule"><div class="landing-row-label"><span>Библиотека</span><span>' + str(len(records)) + ' essays</span></div>' + ''.join(entries) + '<div id="local-drafts"></div></main>'
    (ROOT/'index.html').write_text(page('Библиотека',body,''),encoding='utf-8')


def build_draft_template():
    body = '''<div class="article-grid"><aside class="left-rail"><div class="left-rail-sticky"><div class="rail-title">Черновик</div><a class="rail-link" href="../index.html">← К каталогу</a></div></aside><main class="main-column"><div class="breadcrumb"><a href="../index.html">Библиотека</a><span class="sep">/</span>Локальный черновик</div><div class="article-meta">Ещё не опубликовано</div><div class="article-body article-editable" id="article-content"></div></main><aside class="right-rail"><div class="right-rail-sticky"><div class="rail-title">На этой странице</div><div class="right-toc">Новая статья</div></div></aside></div>'''
    (OUT/'draft.html').write_text(page('Черновик',body,'../'), encoding='utf-8')


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    records=[]
    for file in sorted(NOTES.glob('*.md')):
        if file.name.startswith('_'): continue
        blocks = annotate_if_needed(file)
        build_article(file.stem,blocks,records)
    build_home(records)
    build_draft_template()
    print(f'Built {len(records)} article(s) and homepage')

if __name__ == '__main__': main()
