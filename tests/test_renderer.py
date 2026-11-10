import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from html.parser import HTMLParser
import build
from content_safety import sanitize, validate_collections, validate_blocks
from scripts.package_site import package, PUBLIC

class Inspect(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.tags=[]
        self.feed(source)
    def handle_starttag(self, tag, attrs): self.tags.append((tag,dict(attrs)))

class RendererSecurity(unittest.TestCase):
    def safe(self, markup):
        for tag,attrs in Inspect(markup).tags:
            self.assertNotIn(tag, {'script','iframe','object','embed','svg','math','img','input','button','form','style','template','base','link','meta'})
            for key,value in attrs.items():
                self.assertFalse(key.startswith(('on','data-')), (tag,key,value))
                self.assertNotIn(key, {'style','name','srcdoc','formaction'})
                if key=='href': self.assertFalse(value.lower().startswith(('javascript:','vbscript:','data:','//')),value)
    def test_raw_html(self):
        attacks=['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<iframe srcdoc="<script>evil()</script>"></iframe>',
                 '```{=html}\n<script>alert(1)</script>\n```', '`<img src=x onerror=evil()>`{=html}',
                 '<svg><a xlink:href="javascript:evil()">X</a></svg>', '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=evil()>">']
        for source in attacks:
            with self.subTest(source=source): self.safe(build.pandoc(source))
    def test_attribute_and_url_attacks(self):
        attacks=['[click](javascript:alert%281%29)', '[click](data:text/html,evil)', '[click](jav&#x61;script:evil)',
                 '[click](https://example.org){onclick="evil()" style="position:fixed" id="edit-toolbar" data-action="publish"}',
                 '::: {.proof onclick="evil()" style="position:fixed" #edit-toolbar}\nText\n:::',
                 '# Heading {#ml-article-data onclick="evil()"}', '[click](//evil.example)', '[click](\\\\evil.example)']
        for source in attacks:
            with self.subTest(source=source): self.safe(build.pandoc(source))
    def test_sanitizer_direct_malformed_html(self):
        for source in ['<p><a href="java\nscript:evil()">X', '<svg/onload=evil()>', '<form id="edit-source"><input name="location">', '<script/x>evil()</script>', '<p style="position:fixed" class="editor-modal-head theorem" data-action="publish">X']:
            with self.subTest(source=source): self.safe(sanitize(source))
    def test_allowed_math_proofs_headings_links_tables(self):
        source=build.pandoc('::: {.theorem}\n**Theorem.** $x^2$.\n\n$$x+y=z$$\n:::')
        self.assertIn('class="theorem"',source)
        self.assertIn('class="math inline"',source)
        self.assertIn('class="math display"',source)
        proof=build.fold_proof(build.pandoc('::: {.proof}\n**Proof.** Text.\n:::'))
        self.assertIn('<details class="proof-fold lemma-fold"',proof)
        self.assertIn('https://example.org',build.pandoc('[Link](https://example.org)'))
        self.assertIn('<table>',build.pandoc('|A|B|\n|-|-|\n|1|2|'))
    def test_namespace_prevents_dom_clobbering(self):
        text=build.pandoc('# Title {#edit-source}\n\n[go](#edit-source)')
        self.assertIn('id="content-edit-source"',text)
        self.assertIn('href="#content-edit-source"',text)
    def test_json_script_boundary(self):
        source='</script><script>evil()</script> & \u2028'
        serialized=build.js_json({'source':source})
        self.assertNotIn('<',serialized)
        self.assertEqual(json.loads(serialized)['source'],source)
    def test_folds_validated(self):
        for blocks in [[{'id':'b1','source':'<!-- ml:fold-end -->'}],
                       [{'id':'b1','source':'<!-- ml:fold-start title="X" open="true" -->'}],
                       [{'id':'b1','source':'Text'},{'id':'b1','source':'Other'}]]:
            with self.assertRaises(ValueError):build.validate_folds(blocks)
    def test_path_and_symlink_note(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);(root/'real.md').write_text('# A')
            (root/'test.md').symlink_to(root/'real.md')
            with self.assertRaises(ValueError):build.annotate_if_needed(root/'test.md')
            (root/'draft.md').write_text('# Draft')
            with self.assertRaises(ValueError):build.annotate_if_needed(root/'draft.md')
    def test_schema(self):
        for items in [[{'id':'x','title':'x','description':'','parent':'x','order':1}],
                      [{'id':'../x','title':'x','description':'','parent':None,'order':1}],
                      [{'id':'x','title':'x','description':'','parent':None,'order':True}]]:
            with self.assertRaises(ValueError):validate_collections(items)
        with self.assertRaises(ValueError):validate_blocks([{'id':'bad"','source':'x'}])
    def test_shared_serializer_roundtrip(self):
        script="import './assets/content-policy.js';console.log(MLPolicy.serialize([{id:'b1',source:'# Математика'},{id:'b2',source:'$$x+y=z$$'}],'mathematical-notes'));"
        source=subprocess.check_output(['node','--input-type=module','-e',script],text=True)
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'test.md';path.write_text(source)
            blocks,cid,meta=build.annotate_if_needed(path)
            self.assertEqual(cid,'mathematical-notes');self.assertTrue(meta)
            self.assertEqual(blocks[0]['source'],'# Математика')
            self.assertEqual(blocks[1]['source'],'$$x+y=z$$')
    def test_site_package_excludes_source_secrets_and_unlisted_files(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            for name in PUBLIC:
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('safe')
            for name in ['.dev.vars','publisher/secret.txt','build.py','assets/evil.js','tests/secret.txt']:
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('secret')
            out=package(root)
            for path in out.rglob('*'):
                if path.is_file():self.assertNotIn('secret',path.read_text())
            self.assertFalse((out/'publisher').exists());self.assertFalse((out/'assets/evil.js').exists())
    def test_site_package_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            for name in PUBLIC:
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('safe')
            (root/'collections.json').unlink();(root/'collections.json').symlink_to(root/'index.html')
            with self.assertRaises(ValueError):package(root)

if __name__=='__main__':unittest.main()
