"""Copy only public assets; never publish the repository root or publisher source."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ['index.html', 'collections.json', 'site-config.json',
          'assets/styles.css', 'assets/site.js', 'assets/editor.js', 'assets/publisher.js',
          'assets/content-policy.js', 'assets/mathjax-config.js', 'assets/math-tools.js',
          'assets/vendor/mathjax-tex-svg.js', 'assets/vendor/dompurify.min.js',
          'assets/cayley-free-group.svg', 'assets/math-blocks.css']

def patch_editor(source: str) -> str:
    """Extend the existing v12 editor without replacing its authentication/draft code.

    This transformation changes the *public distribution copy* only. Anchors must
    match exactly; otherwise the build fails instead of silently breaking editing.
    """
    marker = '/* ml-semantic-blocks-v1 */'
    if marker in source:
        return source

    def replace_once(old: str, new: str) -> None:
        nonlocal source
        count = source.count(old)
        if count != 1:
            raise ValueError(f'Editor compatibility check failed for {old[:55]!r}: {count} matches')
        source = source.replace(old, new, 1)

    replace_once(
        "['theorem','lemma','proof','remark','insight'].includes(open[1])",
        "['theorem','lemma','proposition','corollary','definition','statement','exercise','example','proof','remark','insight'].includes(open[1])")
    replace_once("if(type==='fold') {", "if(['fold','proof','solution'].includes(type)) {")
    replace_once("if(!title){setStatus('insert-error','Введите заголовок.',true);return;}",
                 "if(type==='fold' && !title){setStatus('insert-error','Введите заголовок.',true);return;}")
    replace_once(
        "{id:id(),source:foldStartSource(title,$('#insert-open').checked)},",
        "{id:id(),source:foldStartSource(type==='proof'?'Доказательство':type==='solution'?'Решение':title, type==='fold' && $('#insert-open').checked)},")
    replace_once(
        "{id:id(),source:'Напишите здесь текст, определения, формулы или леммы.'}",
        "{id:id(),source:type==='proof'?'Напишите доказательство.':type==='solution'?'Напишите решение.':'Напишите здесь текст, определения, формулы или леммы.'}")
    replace_once(
        "if(type==='theorem')source='::: {.theorem}\\n**Теорема.** Сформулируйте утверждение.\\n:::';",
        """const templates = {
         theorem:['theorem','Теорема','Сформулируйте теорему.'],
         lemma:['lemma','Лемма','Сформулируйте лемму.'],
         proposition:['proposition','Предложение','Сформулируйте предложение.'],
         corollary:['corollary','Следствие','Сформулируйте следствие.'],
         definition:['definition','Определение','Дайте определение.'],
         statement:['statement','Утверждение','Сформулируйте утверждение.'],
         exercise:['exercise','Задача','Сформулируйте задачу.'],
         example:['example','Пример','Приведите пример.'],
         remark:['remark','Замечание','Напишите замечание.']
       };
       if(Object.hasOwn(templates,type)) {
         const [cls,label,placeholder]=templates[type];
         source='::: {.'+cls+'}\\n**'+label+'.** '+placeholder+'\\n:::';
       }""")
    replace_once("if(type==='lemma')source='::: {.lemma}\\n**Лемма.** Сформулируйте утверждение.\\n:::';", "")
    replace_once("if(type==='proof')source='::: {.proof}\\n**Доказательство.** Напишите доказательство.\\n:::';", "")
    replace_once(
        "const target=type==='fold'?items[1].id:items[0].id;",
        "const target=['fold','proof','solution'].includes(type)?items[1].id:items[0].id;")
    # Collapsed by default, including legacy .proof fenced blocks.
    replace_once(
        "'<details class=\"proof-fold lemma-fold\" open><summary",
        "'<details class=\"proof-fold lemma-fold\"><summary")
    return marker + '\n' + source

def package(root=ROOT):
    out = root/'dist'
    if out.is_symlink(): raise ValueError('dist must not be a symlink')
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir()
    files = [root/p for p in PUBLIC]
    for directory, pattern in [('articles','*.html'), ('collections','*.html'), ('notes','*.md'), ('sources','*.pdf'), ('licenses','*.txt')]:
        folder=root/directory
        if folder.is_symlink(): raise ValueError('Symlinked public directory')
        files.extend(folder.glob(pattern))
    for source in files:
        if source.is_symlink() or any((root/p).is_symlink() for p in source.relative_to(root).parents if str(p)!='.'):
            raise ValueError('Symlinked public file')
        if not source.is_file(): raise ValueError('Missing public file: '+str(source))
        destination=out/source.relative_to(root)
        destination.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(source,destination)
    editor = out/'assets/editor.js'
    editor.write_text(patch_editor(editor.read_text(encoding='utf-8')), encoding='utf-8')
    (out/'.nojekyll').touch()
    return out

if __name__ == '__main__': print('Public artifact:', package())
