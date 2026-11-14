"""Mathematical Library: turn Markdown notes into navigable, block-editable static HTML.

Requires Python 3 and Pandoc. Run `python build.py`.
"""
from __future__ import annotations
import html, json, re, subprocess, uuid, hashlib
from urllib.parse import urlsplit
from content_safety import sanitize, validate_blocks, validate_collections, slug as safe_slug, MAX_BYTES
from pathlib import Path
ROOT = Path(__file__).resolve().parent
NOTES = ROOT / 'notes'
OUT = ROOT / 'articles'
COLL_OUT = ROOT / 'collections'
COLLECTIONS_FILE = ROOT / 'collections.json'
COLLECTION_META_RE = re.compile(r'^<!-- ml:collection:([a-z0-9-]+) -->\s*\n(?:\s*\n)?')
ASSET = ROOT / 'assets'
PUBLISHER = json.loads((ROOT/'site-config.json').read_text(encoding='utf-8')).get('publisherOrigin','')
if PUBLISHER:
    parsed=urlsplit(PUBLISHER)
    if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        raise ValueError('publisherOrigin must be an HTTPS origin')
MARKER_RE = re.compile(r'^<!-- ml:block:([a-zA-Z0-9_-]+) -->\s*\n', re.M)
FOLD_START = re.compile(r'^<!-- ml:fold-start title="([^"]+)" open="(true|false)" -->$')
FOLD_END = '<!-- ml:fold-end -->'
# Metadata is stored in an ordinary editable block, not in an external manifest.
# The exact standalone marker is intentionally stripped by Pandoc during rendering.
UNLISTED_MARKER = '<!-- ml:unlisted -->'

def is_unlisted(blocks: list[dict]) -> bool:
    """Unlisted pages have URLs and source editing, but do not enter catalogs."""
    return any(UNLISTED_MARKER in b['source'].splitlines() for b in blocks)

def fold_directive(source: str):
    value = source.strip()
    if value == FOLD_END: return ('end', '', False)
    m = FOLD_START.fullmatch(value)
    if m: return ('start', m.group(1), m.group(2) == 'true')
    return None

def fold_open(block_id: str, title: str, opened: bool) -> str:
    title = html.escape(title)
    bid = html.escape(block_id, quote=True)
    return (f'<details id="block-{bid}" data-block-id="{bid}" class="proof-fold custom-fold"'
            + (' open' if opened else '') + '>'
            '<summary class="proof-fold-summary"><span class="proof-fold-title">' + title + '</span>'
            '<span class="proof-fold-toggle"><span class="when-open">Скрыть</span>'
            '<span class="when-closed">Показать</span><span class="fold-chevron"></span></span>'
            f'<span class="fold-editor-control"><button type="button" data-edit-block="{bid}" title="Название плашки">✎</button>'
            f'<button type="button" data-add-after="{bid}" title="Добавить внутрь">＋</button>'
            f'<button type="button" data-copy-link="{bid}" title="Ссылка">↗</button></span></summary>'
            '<div class="proof-fold-body">')

def validate_folds(blocks: list[dict]) -> None:
    validate_blocks(blocks)
    stack = []
    ids = set()
    for b in blocks:
        if b['id'] in ids: raise ValueError('Duplicate block id: '+b['id'])
        ids.add(b['id'])
        directive=fold_directive(b['source'])
        if directive and directive[0]=='start':
            stack.append(b['id'])
            if len(stack)>12: raise ValueError('Too many nested folds')
        if '<!-- ml:fold-' in b['source'] and not directive: raise ValueError('Invalid fold marker')
        if directive and directive[0]=='end':
            if not stack: raise ValueError('Closing panel without opening marker: '+b['id'])
            stack.pop()
    if stack: raise ValueError('Panel not closed: '+', '.join(stack))

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

def annotate_if_needed(path: Path) -> tuple[list[dict],str,bool]:
    safe_slug(path.stem)
    if path.is_symlink() or not path.is_file() or path.stat().st_size>MAX_BYTES: raise ValueError('Invalid note file')
    text = path.read_text(encoding='utf-8')
    collection_match = COLLECTION_META_RE.match(text)
    collection_id = collection_match.group(1) if collection_match else 'mathematical-notes'
    has_meta = collection_match is not None
    body = text[collection_match.end():] if collection_match else text
    matches = list(MARKER_RE.finditer(body))
    if matches:
        if body[:matches[0].start()].strip():
            raise ValueError(f'Unmarked source preceding first block in {path}')
        return ([dict(id=m.group(1),source=body[m.end():(matches[i+1].start() if i+1 < len(matches) else len(body))].strip())
                 for i,m in enumerate(matches)],collection_id,has_meta)
    chunks = split_unmarked(body)
    result = [dict(id='b' + str(i+1).zfill(3), source=x) for i,x in enumerate(chunks)]
    prefix = f'<!-- ml:collection:{collection_id} -->\n\n' if has_meta else ''
    path.write_text(prefix+''.join(f'<!-- ml:block:{b["id"]} -->\n{b["source"]}\n\n' for b in result),encoding='utf-8')
    return result,collection_id,has_meta

def load_collections() -> list[dict]:
    if COLLECTIONS_FILE.is_symlink() or COLLECTIONS_FILE.stat().st_size>MAX_BYTES: raise ValueError('Invalid collections file')
    items=json.loads(COLLECTIONS_FILE.read_text(encoding='utf-8'))
    validate_collections(items)
    if not isinstance(items,list):raise ValueError('collections.json must contain a list')
    ids=set()
    for c in items:
        if not isinstance(c,dict) or not re.fullmatch('[a-z0-9][a-z0-9-]*',str(c.get('id',''))):
            raise ValueError('Invalid collection identifier: '+str(c))
        if c['id'] in ids: raise ValueError('Duplicate collection id: '+c['id'])
        ids.add(c['id'])
        if not str(c.get('title','')).strip(): raise ValueError('Empty collection title')
    for c in items:
        seen={c['id']};parent=c.get('parent')
        if parent and parent not in ids: raise ValueError('Unknown parent collection: '+parent)
        by_id={x['id']:x for x in items}
        while parent:
            if parent in seen: raise ValueError('Cycle in collection tree')
            seen.add(parent);parent=by_id[parent].get('parent')
    return sorted(items,key=lambda c:(c.get('order',999),c['title'].casefold()))

def esc(s) -> str: return html.escape(str(s),quote=True)


def col_path(cid: str, base: str='') -> str: return base+'collections/'+cid+'.html'


def ancestor_chain(cid: str, by_id: dict) -> list[dict]:
    a=[]
    while cid and cid in by_id:
        c=by_id[cid];a.append(c);cid=c.get('parent')
    return a[::-1]

def collection_tree(collections: list[dict], selected: str='', base: str='') -> str:
    ids={x['id']:x for x in collections}
    children={None:[]}
    for c in collections: children.setdefault(c.get('parent'),[]).append(c)
    def render(parent,level=0):
        return ''.join('<a class="rail-link collection-link'+(' selected' if c['id']==selected else '')+'" '
           f'href="{esc(col_path(c["id"],base))}" style="--depth:{level}">{esc(c["title"])}</a>'
           + render(c['id'],level+1) for c in children.get(parent,[]))
    return render(None)

def breadcrumb(cid: str, by_id: dict, base='../') -> str:
    items=['<a href="'+base+'index.html">Заметки</a>']
    for c in ancestor_chain(cid,by_id):
        items+=['<span class="sep">/</span>','<a href="'+esc(col_path(c['id'],base))+'">'+esc(c['title'])+'</a>']
    return ''.join(items)

def article_list(records: list[dict], base: str='') -> str:
    if not records:return '<p class="empty-collection">В этом разделе пока нет статей.</p>'
    entries=[]
    for i,r in enumerate(sorted(records,key=lambda x:(x['title'].casefold(),x['slug'])),1):
        entries.append(f'<div class="essay-entry"><div><h2 class="essay-title"><a href="{base}articles/{esc(r["slug"])}.html">{esc(r["title"])}</a></h2>'
                       f'<p class="essay-desc">{esc(r.get("description") or "Математический текст")}</p></div><div class="essay-index">{i:02}</div></div>')
    return ''.join(entries)

def pandoc(source: str) -> str:
    p = subprocess.run(['pandoc', '-f', 'markdown+tex_math_dollars+tex_math_single_backslash+fenced_divs-raw_html-raw_attribute+auto_identifiers',
                        '-t','html5','--mathjax','--wrap=none'], input=source, text=True,
                       capture_output=True, check=True, timeout=15)
    return sanitize(p.stdout.strip())

def fold_proof(markup: str) -> str:
    if not re.match(r'<div\b[^>]*\bclass="[^"]*\bproof\b', markup): return markup
    first = markup.find('>') + 1
    last = markup.rfind('</div>')
    if last < first: return markup
    inner = markup[first:last]
    return ('<details class="proof-fold lemma-fold">'
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

def page(title: str, body: str, base: str = '', collections=None, active_collection: str = '') -> str:
    css = (ASSET/'styles.css').read_text(encoding='utf-8')
    return f'''<!DOCTYPE html><html lang="ru" data-theme="light"><head>
<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' {esc(PUBLISHER)}; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'">
<meta name="referrer" content="no-referrer"><meta name="ml-site-version" content="site-v12-20261111"><meta name="ml-publisher" content="{esc(PUBLISHER)}"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#fbfaf7"><meta name="ml-collection" content="{esc(active_collection)}"><meta name="robots" content="noindex,nofollow"><title>{html.escape(title)} · Некоторые заметки</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;650;700&family=STIX+Two+Text:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>{css}</style>
<link rel="stylesheet" href="{base}assets/math-blocks.css">
<script defer src="{base}assets/mathjax-config.js"></script>
<script defer src="{base}assets/vendor/mathjax-tex-svg.js"></script>
<script defer src="{base}assets/site.js"></script>
<script defer src="{base}assets/vendor/dompurify.min.js"></script>
<script defer src="{base}assets/content-policy.js"></script>
<script defer src="{base}assets/publisher.js"></script>
<script defer src="{base}assets/math-tools.js"></script>
<script defer src="{base}assets/editor.js"></script>
</head><body>
<div class="progress" aria-hidden="true"></div>
<header class="site-header"><a class="brand" href="{base}index.html"><span class="brand-text">Некоторые заметки</span></a>
<nav class="header-nav"><button type="button" class="rail-control" data-rail-toggle="left" aria-label="Показать или скрыть разделы" aria-controls="left-navigation" aria-expanded="false" title="Разделы"><span aria-hidden="true">☰</span><span class="rail-control-label">Разделы</span></button><button type="button" class="rail-control" data-rail-toggle="right" aria-label="Показать или скрыть оглавление" aria-controls="right-navigation" aria-expanded="false" title="Оглавление"><span aria-hidden="true">≡</span><span class="rail-control-label">Оглавление</span></button><button type="button" class="icon-btn" data-theme-toggle aria-label="Тёмная тема">☾</button></nav></header>
<div class="rail-scrim" data-rail-dismiss aria-hidden="true"></div>
{body}
<script id="ml-collections-data" type="application/json">{js_json(collections or [])}</script>
<footer class="page-footer"><span>Некоторые заметки</span></footer>
<!-- Credentials stay on the separate publisher origin. -->
<div id="edit-toolbar" hidden><span class="editor-pill">✎ Режим редактирования · v12</span><button type="button" data-action="new-article">＋ Статья</button><button type="button" data-action="new-collection">＋ Раздел</button><button type="button" data-action="publish-article">Опубликовать</button><button type="button" data-action="export-draft">Экспорт</button><button type="button" data-action="discard-draft">Сбросить черновик</button><button type="button" data-action="connect">Войти / выйти</button><button type="button" data-action="exit-edit">Готово</button></div>
<dialog id="insert-dialog"><div class="editor-modal-head"><h2>Добавить блок</h2><button type="button" class="x-close" data-action="close-dialog">×</button></div>
<label for="insert-type">Тип нового блока</label><select id="insert-type"><option value="text">Обычный текст или формула</option><option value="theorem">Теорема</option><option value="lemma">Лемма</option><option value="proposition">Предложение</option><option value="corollary">Следствие</option><option value="definition">Определение</option><option value="statement">Утверждение</option><option value="exercise">Задача</option><option value="example">Пример</option><option value="remark">Замечание</option><option value="proof">Сворачиваемое доказательство</option><option value="solution">Сворачиваемое решение</option><option value="fold">Сворачиваемая плашка с любым содержимым</option><option value="link">Ссылка на отдельную статью / доказательство</option></select>
<div id="insert-options" hidden><label for="insert-title">Название плашки или ссылка</label><input id="insert-title" value="Подробности"><div id="insert-link-options" hidden><label for="insert-slug">Адрес статьи (латиницей)</label><input id="insert-slug" placeholder="proof-of-main-theorem"><p class="editor-note">Ссылка ведёт на отдельную статью. Создать её можно кнопкой «＋ Статья».</p></div><label id="insert-open-label"><input id="insert-open" type="checkbox" checked> Изначально раскрыта</label></div>
<p class="editor-note">В раскрывающейся плашке можно вставлять и редактировать обычные блоки, теоремы, формулы и даже другие плашки.</p><p id="insert-error" role="status"></p><div class="editor-actions"><button type="button" data-action="close-dialog">Отмена</button><button class="primary-editor" type="button" data-action="insert-block">Добавить</button></div></dialog>
<dialog id="edit-dialog"><form method="dialog" id="edit-form"><div class="editor-modal-head"><h2 id="edit-dialog-title">Edit block</h2><button type="button" class="x-close" data-action="close-dialog" aria-label="Закрыть">×</button></div><p id="edit-hint"></p><label for="edit-source">Математический исходный текст (Markdown + LaTeX)</label><div class="source-editor"><pre id="edit-highlight" aria-hidden="true"></pre><textarea id="edit-source" spellcheck="false" rows="13" aria-label="Markdown и LaTeX исходный текст"></textarea></div><p id="edit-math-status" role="status">LaTeX проверяется при сохранении.</p><p class="editor-preview-label">Предпросмотр (упрощённый; окончательный HTML строится Pandoc)</p><div id="edit-preview" class="article-body" aria-live="polite"></div><p id="edit-error" role="status"></p><div class="editor-actions"><button type="button" data-action="delete-block" class="editor-delete">Удалить блок</button><button type="button" data-action="save-draft">Сохранить черновик</button><button type="button" class="primary-editor" data-action="publish">Опубликовать в GitHub</button></div></form></dialog>
<dialog id="new-dialog"><div class="editor-modal-head"><h2>Новая статья</h2><button type="button" class="x-close" data-action="close-dialog">×</button></div><label for="new-title">Название</label><input id="new-title" placeholder="Например, Концы групп"><label for="new-slug">Адрес (латиницей)</label><input id="new-slug" placeholder="ends-of-groups"><label for="new-category">Раздел</label><select id="new-category"></select><p id="new-error" role="status"></p><div class="editor-actions"><button type="button" data-action="create-local">Создать черновик</button><button class="primary-editor" type="button" data-action="create-publish">Создать и опубликовать</button></div></dialog>
<dialog id="collection-dialog"><div class="editor-modal-head"><h2>Новый раздел</h2><button type="button" class="x-close" data-action="close-dialog">×</button></div>
<label for="collection-title">Название раздела</label><input id="collection-title" placeholder="Например, Algebraic topology">
<label for="collection-id">Адрес раздела (латиницей)</label><input id="collection-id" placeholder="algebraic-topology">
<label for="collection-parent">Расположение</label><select id="collection-parent"></select>
<label for="collection-description">Краткое описание (необязательно)</label><textarea id="collection-description" rows="3" placeholder="Что будет в этом разделе"></textarea>
<p id="collection-error" role="status"></p><div class="editor-actions"><button type="button" data-action="create-collection-local">Сохранить на этом устройстве</button><button class="primary-editor" type="button" data-action="create-collection-publish">Создать и опубликовать</button></div></dialog>
</body></html>'''


def display_with_legacy_folds(slug: str, blocks: list[dict]) -> list[dict]:
    """Render old pre-v7 notes with fold panels without altering their sources.
    The browser editor already migrates these on the first local edit. We must
    leave its source JSON unchanged so the GitHub SHA/content check is accurate.
    """
    if slug!='coarse-group-cohomology' or any(fold_directive(b['source']) for b in blocks):
        return blocks
    ids={b['id'] for b in blocks}
    if not {'b006','b040','b060'} <= ids:
        return blocks
    out=[]
    for b in blocks:
        out.append(b)
        if b['id']=='b006':out.append({'id':'foldalg','source':'<!-- ml:fold-start title="Алгебраическое доказательство" open="true" -->'})
        elif b['id']=='b040':
            out.insert(-1,{'id':'foldalgend','source':'<!-- ml:fold-end -->'})
            out.append({'id':'foldgeo','source':'<!-- ml:fold-start title="Геометрическое доказательство" open="true" -->'})
        elif b['id']=='b060':out.insert(-1,{'id':'foldgeoend','source':'<!-- ml:fold-end -->'})
    validate_folds(out)
    return out

def build_article(slug: str, blocks: list[dict], collection_id: str, has_meta: bool,
                  collections: list[dict], records: list[dict]) -> None:
    by_id={c['id']:c for c in collections}
    if collection_id not in by_id:raise ValueError(f'Unknown collection {collection_id} in {slug}')
    title = re.sub(r'^#\s+', '', blocks[0]['source'].splitlines()[0]).strip() if blocks else slug
    cat=by_id[collection_id]
    toc_items,result=[],[]
    display_blocks=display_with_legacy_folds(slug,blocks)
    validate_folds(display_blocks)
    for b in display_blocks:
        source=b['source'];directive=fold_directive(source)
        if directive:
            result.append(fold_open(b['id'],directive[1],directive[2]) if directive[0]=='start' else '</div></details>')
            continue
        m=re.match(r'^#{2,3} (.+)$',source.strip())
        result.append(block_html(b))
        if m:
            plain=re.sub(r'\$[^$]*\$','',m.group(1)).strip() or 'Раздел'
            toc_items.append(('block-'+b['id'],plain,2 if source.startswith('## ') else 3))
    toc=''.join(f'<a href="#{target}" class="level-{level}">{esc(name)}</a>' for target,name,level in toc_items)
    raw_data={'slug':slug,'title':title,'collection':collection_id,'category':cat['title'],
              'sourceHasMeta':has_meta,'sourceSha256':hashlib.sha256((NOTES/f'{slug}.md').read_bytes()).hexdigest(),'sourceExact':(NOTES/f'{slug}.md').read_text(encoding='utf-8'),
              'path':f'notes/{slug}.md','blocks':blocks}
    in_category=[r for r in records if r['collection']==collection_id and r['slug']!=slug]
    related=''.join('<a class="rail-link" href="'+esc(r['slug'])+'.html">'+esc(r['title'])+'</a>' for r in in_category[:15])
    # Supplementary pages are not entries in the article navigation, not even
    # while viewing one of those pages. Their main article remains listed.
    current=('' if is_unlisted(blocks) else
             '<a class="rail-link selected" href="'+esc(slug)+'.html">'+esc(title)+'</a>')
    side=collection_tree(collections,collection_id,'../')
    page_body=f'''<div class="article-grid">
<aside id="left-navigation" class="left-rail" aria-label="Разделы сайта"><div class="left-rail-sticky"><div class="rail-title">Разделы</div>{side}
<div class="rail-title rail-subheading">В этом разделе</div>{current}{related}</div></aside>
<main class="main-column"><div class="breadcrumb">{breadcrumb(collection_id,by_id)}</div>
<div class="article-body article-editable" id="article-content">{''.join(result)}</div><div class="article-bottom"><a href="../notes/{esc(slug)}.md">Исходный Markdown</a></div></main>
<aside id="right-navigation" class="right-rail" aria-label="Оглавление статьи"><div class="right-rail-sticky"><div class="rail-title">На этой странице</div><nav class="right-toc">{toc}</nav></div></aside></div>
<script id="ml-article-data" type="application/json">{js_json(raw_data)}</script>'''
    (OUT/f'{slug}.html').write_text(page(title,page_body,'../',collections,collection_id),encoding='utf-8')

def build_collection_pages(collections: list[dict], records: list[dict]) -> None:
    COLL_OUT.mkdir(parents=True,exist_ok=True)
    by_id={c['id']:c for c in collections}
    for c in collections:
        children=[x for x in collections if x.get('parent')==c['id']]
        direct=[r for r in records if r['collection']==c['id']]
        cards=''.join(f'<a class="collection-card" href="{esc(child["id"])}.html"><span class="card-eyebrow"></span><strong>{esc(child["title"])}</strong><span>{esc(child.get("description", ""))}</span><span class="collection-arrow">↗</span></a>' for child in children)
        children_part=('<h2 class="collection-label">Подразделы</h2><div class="collection-cards">'+cards+'</div>') if children else ''
        body=f'''<div class="collection-layout"><aside id="left-navigation" class="collection-rail" aria-label="Разделы сайта"><div class="rail-title">Разделы</div>{collection_tree(collections,c['id'],'../')}</aside>
<main class="collection-main"><div class="breadcrumb">{breadcrumb(c['id'],by_id)}</div>
<h1>{esc(c['title'])}</h1><p class="landing-intro">{esc(c.get('description',''))}</p>
{children_part}<div class="landing-row-label"><span>Статьи</span><span>{len(direct)}</span></div>{article_list(direct,'../')}
<div id="local-drafts"></div><div id="local-collections"></div>
</main></div>'''
        (COLL_OUT/f'{c["id"]}.html').write_text(page(c['title'],body,'../',collections,c['id']),encoding='utf-8')

def build_home(records: list[dict],collections: list[dict]) -> None:
    roots=[c for c in collections if not c.get('parent')]
    def count_all(root_id: str) -> int:
        subs={root_id};changed=True
        while changed:
            before=len(subs)
            for c in collections:
                if c.get('parent') in subs:subs.add(c['id'])
            changed=len(subs)>before
        return sum(1 for r in records if r['collection'] in subs)
    def count_label(n: int) -> str:
        if n==0: return ''
        suffix='статья' if n%10==1 and n%100!=11 else ('статьи' if n%10 in (2,3,4) and n%100 not in (12,13,14) else 'статей')
        return f'{n} {suffix}'
    cards=''.join(f'<a class="collection-card" href="{esc(col_path(c["id"]))}"><span class="card-eyebrow">{count_label(count_all(c["id"]))}</span><strong>{esc(c["title"])}</strong><span>{esc(c.get("description", ""))}</span><span class="collection-arrow">↗</span></a>' for c in roots)
    body=f'''<main class="landing"><h1>Некоторые заметки</h1>
<hr class="landing-rule"><div class="landing-row-label"><span>Разделы</span></div>
<div class="collection-cards">{cards}</div><div id="local-drafts"></div><div id="local-collections"></div></main>'''
    (ROOT/'index.html').write_text(page('Заметки',body,'',collections),encoding='utf-8')

def build_draft_template(collections: list[dict]):
    body = '''<div class="article-grid"><aside id="left-navigation" class="left-rail" aria-label="Разделы сайта"><div class="left-rail-sticky"><div class="rail-title">Черновик</div><a class="rail-link" href="../index.html">← К каталогу</a></div></aside><main class="main-column"><div class="breadcrumb"><a href="../index.html">Заметки</a><span class="sep">/</span>Локальный черновик</div><div class="article-body article-editable" id="article-content"></div></main><aside id="right-navigation" class="right-rail" aria-label="Оглавление статьи"><div class="right-rail-sticky"><div class="rail-title">На этой странице</div><div class="right-toc">Новая статья</div></div></aside></div>'''
    (OUT/'draft.html').write_text(page('Черновик',body,'../',collections), encoding='utf-8')

def main():
    if NOTES.is_symlink() or not NOTES.is_dir(): raise ValueError('notes must be a real directory')
    OUT.mkdir(parents=True,exist_ok=True)
    collections=load_collections()
    records=[];sources=[]
    for file in sorted(NOTES.glob('*.md')):
        if file.name.startswith('_'):continue
        blocks,cid,has_meta=annotate_if_needed(file)
        sources.append((file.stem,blocks,cid,has_meta))
        if not is_unlisted(blocks):
            title=re.sub(r'^#\s+', '',blocks[0]['source'].splitlines()[0]).strip() if blocks else file.stem
            records.append({'slug':file.stem,'title':title,'collection':cid})
    for slug,blocks,cid,has_meta in sources:
        build_article(slug,blocks,cid,has_meta,collections,records)
    # Remove HTML for articles no longer in the sources.
    valid={slug+'.html' for slug,_,_,_ in sources}|{'draft.html'}
    for f in OUT.glob('*.html'):
        if f.name not in valid:f.unlink()
    build_collection_pages(collections,records)
    valid_cols={c['id']+'.html' for c in collections}
    for f in COLL_OUT.glob('*.html'):
        if f.name not in valid_cols:f.unlink()
    build_home(records,collections)
    build_draft_template(collections)
    print(f'Built {len(records)} listed article(s), {len(sources)-len(records)} supplementary page(s), {len(collections)} collection(s), and homepage')
if __name__ == '__main__':main()
