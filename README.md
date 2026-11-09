# Mathematical Library — working browser-editor prototype (v4)

This is the next version of the mathematical website. **The reader sees a clean essay, without editing controls.** In editing mode you can select an existing paragraph, equation, theorem, lemma, or proof; add a block; create a new article; and copy a permanent link to an individual block. The whole mathematical note is preserved.

> IMPORTANT: This is a functional **prototype**, not a production-grade CMS. GitHub API saving and GitHub Pages deployment require your own GitHub repository and a one-time configuration. The live editor uses a simplified Markdown preview; Pandoc produces the final article after publication. It is NOT a full LaTeX compiler.

## 1. Try it without publishing

- Extract the ZIP. Don't open the site from inside the ZIP viewer.
- Open `index.html` and select the article. On some devices `file://` pages restrict storage and cross-file JavaScript; use the local server instructions below if needed.
- To display editing controls, append `?edit=1` to the article URL or press **Ctrl+Shift+E**. On a phone you can bookmark the URL ending in `?edit=1`.
- Hover over (or tap) any text block and select `✎ Изменить` to edit it. Click `＋` to add a block after it. `↗` copies a deep link to that block. Clicking `Новая статья` in the editing toolbar creates a new local article.
- **Save draft** stores changes in the **current browser on the current device** using localStorage. Drafts are not synchronized across devices, and browser cleanup or private mode can erase them. To synchronize, publish to GitHub (below).
- **Publish to GitHub** uses the GitHub REST API after you explicitly connect a repository and provide a limited-permission token. A token is never embedded in the site or saved to browser storage; you must enter it again after a page reload or navigation.

### Local preview server (Windows / VS Code)

With Python installed, open the project folder in VS Code and run in its terminal:

```
py -m http.server 8000
```

Then open http://localhost:8000/ and add `?edit=1` after the article URL to edit. If you have another device on the same local network, you'd need to configure its connection separately; GitHub Pages is simpler for multi-device access.

## 2. Publish the site to GitHub Pages for free

1. Create a **public** repository named `math-library` at https://github.com/new .
2. Upload **all the extracted project files**, including `notes`, `assets`, `articles`, `build.py`, and the hidden `.github/workflows/pages.yml`. **You must include `.github`**. Commit to branch `main`.
3. In the repository go to **Settings → Pages → Build and deployment**, choose **GitHub Actions**.
4. The workflow automatically runs `python build.py` after pushes to `main`, and deploys the generated website. After the initial run you should see `https://YOUR-USERNAME.github.io/math-library/`.
5. There is no password on the *reading* website. Publishing requires GitHub authorization, not a hidden edit button.

Documentation: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages

## 3. Enable online publishing from the editor (optional)

This prototype supports an explicit, repository-scoped token rather than running its own authentication server. This is practical for experimentation, but less seamless than full OAuth login.

1. At https://github.com/settings/personal-access-tokens/new , create a **fine-grained personal access token**, limited to your **math-library** repository. Choose the *Contents* repository permission: **Read and write**. Choose an expiration date. Do not enable permissions for any other repositories.
2. Open your live website with `?edit=1`, click **GitHub**, and enter your GitHub username, repository (`math-library`), branch (`main`), and the token.
3. Click **Edit** on a block → update the Markdown/LaTeX source → **Publish to GitHub**. The editor commits the changed Markdown to `notes/ARTICLE.md`. The GitHub Actions workflow generates HTML automatically.
4. You can also choose **New article → Create and publish**; it adds a new Markdown file. If you are not connected, the article is saved as a local draft first.
5. Changes appear online once the workflow completes. The original article page will not instantly display the updated generated HTML until deployed/reloaded.

**Security:** Never share your token, put it in a URL, include it in a Markdown file, or paste it into a chat. The browser sends the token only to `api.github.com` when making a GitHub API request. It is kept only in the page's memory, not in `localStorage`. Because all browser-delivered JavaScript can access in-memory data, use this only with code you trust and a strictly repository-scoped, short-lived token. This is a practical prototype, *not* a claim of comprehensive security auditing. You can revoke the token at any time from GitHub settings.

GitHub Contents API: https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents

## 4. Writing and source structure

- `notes/*.md` — the mathematical text. The generator inserts stable `<!-- ml:block:... -->` identifiers for block links and contextual editing. The IDs survive adding/removing surrounding paragraphs.
- `articles/*.html` — the generated webpages; don't edit these directly.
- `assets/styles.css` — visual design. `assets/site.js` — reading-mode controls. `assets/editor.js` — contextual editor and optional GitHub save. `assets/vendor/` — embedded MathJax library (Apache 2.0; see `licenses/`).
- `build.py` — Python/Pandoc site generator. Scans all `.md` notes, renders each to a page, and rebuilds the home catalogue.
- `.github/workflows/pages.yml` — automatic publishing action.
- `sources/original-note.pdf` — the original PDF provided for this prototype.

Write equations as `$a+b$` or `$$a+b=c$$`. Use Pandoc fenced-divs for theorem/proof-like blocks:

```
::: {.theorem #thm-group}
**Theorem.** An example $x=y$.
:::

::: {.proof}
**Proof.** Details go here. $\square$
:::
```

The published proof blocks are collapsible. For a cross-page link to a *specific block*, use a normal Markdown link:

```
[See the proof](coarse-group-cohomology.html#block-b017)
```

Links to labelled statements (e.g. `#thm-group`) also work. **Automatic cross-document numbering and an interactive citation picker have NOT been implemented yet.** Those should be tackled after testing this editing workflow, rather than advertised as complete.

## 5. Limits and cautions

- Browser editing uses **Markdown with LaTeX math**, not arbitrary `.tex` source. Converting an existing full LaTeX ecosystem with `\input`, custom macros and TikZ needs a separate publishing pipeline.
- The **live preview is approximate** for complex Markdown and custom theorem environments. The published HTML is generated by Pandoc.
- Local drafts are not backup copies; publish to GitHub for durable, multi-device versions. A failed publish leaves a local draft rather than silently discarding text.
- Changes on GitHub that occurred since the page loaded are detected before saving, to avoid silent overwrites; reload the article and re-apply your local draft if you see that warning.
- The website includes `<meta name="robots" content="noindex,nofollow">` by default: compliant search engines are asked not to index it. This does **not** make either the website or public GitHub source private. Remove the tag in `build.py` if you want search engines to index it.
- This sample article originated from an earlier AI-generated text. No new mathematical proof audit was performed for this website task.
- Browser interaction could not be fully tested in the sandbox environment; browser navigation was blocked by the execution environment. Static HTML structure, Python compilation, and JavaScript syntax were checked.
