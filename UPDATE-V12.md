# v12 — Public mathematical site

Upload these files to PUBLIC `Kefirtshik83/math-library`, preserving directories. Mathematical article files and `collections.json` are intentionally omitted.

After GitHub Actions is green, check:
https://kefirtshik83.github.io/math-library/site-config.json
Expected `"siteVersion":"site-v12-20261111"`.

Open an article with `?edit=1`. Click `Войти / выйти` once to connect the editing session. Then save drafts locally or publish from the article, with an inline result message. A scoped session expires after ~12 minutes; reauthorization may then be needed. There is no extra code-comparison page in the new default flow.

The WordPress-style live WYSIWYG preview is not a guarantee of successful arbitrary LaTeX compilation. The existing MathJax validation is retained. No existing article/collection content or workflow files are included.

**If anything fails:** preserve your browser draft, check the GitHub commit history before retrying, and report the error. Neither client nor server automatically retries a possibly submitted commit.
