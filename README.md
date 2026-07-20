# 字墙 · HSK Wall

A pannable, interactive wall of Chinese vocabulary flashcards (HSK 1–6).

**Live:** https://littletaz.github.io/hsk/

## Status

This is the initial skeleton — just enough to confirm the repo is wired up
to GitHub Pages correctly. No app logic yet.

## Roadmap

- [ ] One-card Canvas2D prototype: gradient + grain-texture card, click-to-open
      transition into a flashcard detail view
- [ ] Full pannable wall (all 150 HSK1 words), canvas-rendered
- [ ] HSK 2–6 word data
- [ ] Filters (part of speech, HSK level, etc.)
- [ ] Audio pronunciation (v1.5)
- [ ] Illustrations
- [ ] Flashcard/quiz game mode (v2)

## Running locally

No build step — it's plain static HTML/CSS/JS. Just open `index.html`
directly in a browser, or serve the folder with any static server, e.g.:

```bash
python3 -m http.server 8000
```

then visit `http://localhost:8000`.

## Deployment

GitHub Pages, served from the `main` branch root. Any push to `main`
updates the live site within a minute or two.
