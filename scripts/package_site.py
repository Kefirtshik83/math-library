"""Copy only public assets; never publish the repository root or publisher source."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ['index.html', 'collections.json', 'site-config.json',
          'assets/styles.css', 'assets/site.js', 'assets/editor.js', 'assets/publisher.js',
          'assets/content-policy.js', 'assets/mathjax-config.js', 'assets/math-tools.js',
          'assets/vendor/mathjax-tex-svg.js', 'assets/vendor/dompurify.min.js']

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
    (out/'.nojekyll').touch()
    return out

if __name__ == '__main__': print('Public artifact:', package())
