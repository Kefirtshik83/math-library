"""Inline figures may load only repository-local, flat assets."""
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from content_safety import sanitize
from scripts.package_site import PUBLIC


class ArticleImageTests(unittest.TestCase):
    def test_svg_is_published(self):
        self.assertIn('assets/cayley-free-group.svg', PUBLIC)

    def test_local_svg_is_retained(self):
        out = sanitize('<p><img src="../assets/cayley-free-group.svg" alt="Граф Кэли"></p>')
        self.assertIn('src="../assets/cayley-free-group.svg"', out)
        self.assertIn('Граф Кэли', out)

    def test_remote_and_traversal_sources_are_rejected(self):
        for src in [
            'https://example.org/tracker.png',
            '//example.org/tracker.png',
            'data:image/svg+xml,<svg/>',
            'javascript:alert(1)',
            '../assets/../publisher/private.svg',
            '../assets/evil.svg?x=1',
            '../assets/%2e%2e/foo.svg',
        ]:
            with self.subTest(src=src):
                out = sanitize(f'<img src="{src}" alt="x">')
                self.assertNotIn('src=', out)

    def test_no_inline_svg_or_executable_attribute(self):
        out = sanitize('<svg onload="alert(1)"></svg><img src="../assets/cayley-free-group.svg" onerror="alert(1)">')
        self.assertNotIn('<svg', out)
        self.assertNotIn('onerror', out)
        self.assertNotIn('onload', out)


if __name__ == '__main__':
    unittest.main()
