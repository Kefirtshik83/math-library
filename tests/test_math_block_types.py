"""Global semantic blocks and direct supplementary article support."""
import re
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.package_site import PUBLIC, patch_editor


class SemanticBlocksTests(unittest.TestCase):
    def test_editor_menu_matches_all_semantic_classes(self):
        build = (ROOT / 'build.py').read_text(encoding='utf-8')
        safety = (ROOT / 'content_safety.py').read_text(encoding='utf-8')
        css = (ROOT / 'assets/math-blocks.css').read_text(encoding='utf-8')
        self.assertIn('assets/math-blocks.css', build)
        self.assertIn('assets/math-blocks.css', PUBLIC)
        for kind in ('theorem', 'lemma', 'proposition', 'corollary', 'definition',
                     'statement', 'exercise', 'example', 'remark'):
            with self.subTest(kind=kind):
                self.assertIn('value="'+kind+'"', build)
                self.assertIn("'"+kind+"'", safety)
                self.assertIn("'"+kind+"'", patch_editor(self.original_snippets()))
                self.assertIn('.'+kind, css if kind not in ('theorem','lemma') else css + build)
        for kind in ('proof', 'solution'):
            self.assertIn('value="'+kind+'"', build)
        self.assertIn('open="false"', (ROOT / 'notes/free-groups-presentations.md').read_text())

    @staticmethod
    def original_snippets():
        return """(() => {
          const open = s.match(/^:::\\s*\\{\\.([\\w-]+)[^}]*\\}\\s*\\n/);
          const cls=['theorem','lemma','proof','remark','insight'].includes(open[1]);
          function insertBlock() {
             if(type==='fold') {
               if(!title){setStatus('insert-error','Введите заголовок.',true);return;}
               items=[
                 {id:id(),source:foldStartSource(title,$('#insert-open').checked)},
                 {id:id(),source:'Напишите здесь текст, определения, формулы или леммы.'},
                 {id:id(),source:'<!-- ml:fold-end -->'}
               ];
             } else {
               let source='Новый математический текст.';
               if(type==='theorem')source='::: {.theorem}\\n**Теорема.** Сформулируйте утверждение.\\n:::';
               if(type==='lemma')source='::: {.lemma}\\n**Лемма.** Сформулируйте утверждение.\\n:::';
               if(type==='proof')source='::: {.proof}\\n**Доказательство.** Напишите доказательство.\\n:::';
               items=[{id:id(),source}];
             }
             const target=type==='fold'?items[1].id:items[0].id;
          }
          function renderBlock() {
            content.innerHTML='<details class="proof-fold lemma-fold" open><summary class="proof-fold-summary">'+html+'</summary>';
          }
        })();"""

    def test_patch_is_valid_and_idempotent(self):
        patched = patch_editor(self.original_snippets())
        self.assertIn("type==='proof'?'Доказательство'", patched)
        self.assertIn("type==='solution'?'Решение'", patched)
        self.assertIn("'Определение'", patched)
        self.assertIn("'Задача'", patched)
        self.assertNotIn('lemma-fold" open>', patched)
        self.assertEqual(patched, patch_editor(patched))
        self.assertNotIn('eval(', patched)
        if shutil.which('node'):
            result = subprocess.run(['node', '--check', '--input-type=commonjs'],
                                    input=patched, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_does_not_accept_changed_editor_silently(self):
        with self.assertRaisesRegex(ValueError, 'compatibility'):
            patch_editor('/* v13 updated file */')

    def test_catalog_metadata_and_linked_proof_pages(self):
        main = (ROOT / 'notes/free-groups-presentations.md').read_text(encoding='utf-8')
        self.assertNotIn('<!-- ml:unlisted -->', main)
        for name in ('free-groups-nielsen-schreier', 'free-groups-hopficity'):
            body = (ROOT / 'notes' / (name+'.md')).read_text(encoding='utf-8')
            self.assertIn('<!-- ml:unlisted -->', body)
            self.assertIn('('+name+'.html)', main)
        builder = (ROOT / 'build.py').read_text(encoding='utf-8')
        self.assertIn('if not is_unlisted(blocks)', builder)
        self.assertIn('build_article(slug,blocks,cid,has_meta,collections,records)', builder)
        self.assertIn('build_collection_pages(collections,records)', builder)

    def test_panels_are_balanced_and_initially_closed(self):
        for path in (ROOT/'notes').glob('*.md'):
            contents=path.read_text(encoding='utf-8')
            balance=0
            for part in re.findall(r'<!-- ml:fold-(?:start[^>]*|end) -->', contents):
                if part.startswith('<!-- ml:fold-start'):
                    self.assertIn('open="false"', part)
                    balance+=1
                else:
                    balance-=1
                self.assertGreaterEqual(balance,0, f'Unexpected fold end in {path.name}')
            self.assertEqual(balance,0, path.name)

    def test_pandoc_renders_semantic_blocks(self):
        if not shutil.which('pandoc'):
            self.skipTest('Pandoc is not installed')
        sample='::: {.definition}\n**Определение.** $F(X)$\n:::\n\n::: {.exercise}\n**Задача.** $g=1$\n:::\n'
        result=subprocess.run(['pandoc','-f','markdown+tex_math_dollars+fenced_divs-raw_html-raw_attribute+auto_identifiers',
                               '-t','html5','--mathjax'],input=sample,text=True,capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('class="definition"',result.stdout)
        self.assertIn('class="exercise"',result.stdout)
        self.assertIn('math inline',result.stdout)


if __name__ == '__main__':
    unittest.main()
