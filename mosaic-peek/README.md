# Mosaic Peek v1

Turn a list of URLs into a visual wall of peek tiles, drag them into named groups, click to reopen the real site.

## Open it
- Double-click `index.html` (works from `file://`), or
- `cd /workspace/mosaic-peek && python3 -m http.server 8080` then open http://localhost:8080

No build step, no dependencies, no frameworks — one self-contained `index.html`.

## Use
- **+ Import URLs** — paste one URL per line, or paste/load a CSV (column named `url`/`link`, else first column; optional `title`/`name` column). Bare domains get `https://`. Dedupes by normalized URL (ignores scheme, `www.`, trailing slash, `#hash`). "Sample URLs" fills 12 demo links.
- You can also just paste URLs anywhere on the page (outside inputs) → they land in Ungrouped.
- **+ Group** creates a group; double-click a group name (or Rename) to rename; ↑/↓ reorder; Delete moves its tiles back to Ungrouped; "Open all" opens a group's tabs.
- **Drag** tiles between groups; drop on a tile to insert before it. Clicks within 300 ms of a drag are ignored, so dragging never opens a tab.
- **Click a tile** (or ↗) opens it in a new tab. Hover actions: ✎ rename title, ↻ re-capture peek, ✕ remove.
- Filter box searches URL + title; slider resizes tiles.
- **Export JSON / Import JSON** — whole board (groups, tiles, titles, cached screenshot URLs).
- State persists in `localStorage` (key `mosaicPeek.v1`).

## Peeks
- Favicon: `https://www.google.com/s2/favicons?domain=…&sz=64`.
- Screenshot: `https://api.microlink.io/?url=…&screenshot=true&meta=false`, 2 requests at a time, result URL cached in the board so reloads don't re-fetch.
- On failure → styled placeholder (domain + favicon, color from domain). On HTTP 429 / rate-limit → remaining queue switches to "preview rate-limited" placeholders for 10 min; **↻ Peeks** retries failed/limited ones.
- Caveats: Microlink's free, keyless tier is small (roughly ~50 requests/day per IP), each capture takes a few seconds, sites with bot walls/logins may return blank or consent screens, and cached screenshot URLs are hosted by Microlink and may expire (a broken image falls back to the placeholder; ↻ re-captures).

## v1 scope
In: paste/CSV import, mosaic grid, groups (create/rename/delete/reorder), drag-and-drop, one-click open, localStorage, JSON export/import.
Out (later): Tree view (v1.1), browser extension reading open tabs, live iframes / in-tile browsing, multi-user sync, auth, API-key Microlink tier.
