# CSS Layout Debug

Debug and fix CSS layout issues in this Spotify Lyrics Player project.

## When to use

User reports: scrollbars appearing, elements too small/large, layout breaking, content overflow, or elements not filling their containers.

## Known gotchas (from this project)

1. **Never use `height: 100vh` + `overflow: hidden` on containers** — use `min-height: 100vh` instead. Forced viewport height breaks content flow.
2. **Never hide scrollbars with CSS** — fix the layout that causes overflow. User explicitly rejected scrollbar hiding.
3. **Never add restrictive `max-width` on `.album-art`** — let it fill its grid column naturally. User complained "圖片縮小了" when max-width was 380px.
4. **Never add `max-height` on `.lyrics-container`** — use flexbox column for flexible sizing.
5. **Use `min-height: 100vh` NOT `height: 100vh`** on `.container` — allows content to flow while filling viewport.

## Debug procedure

1. Identify which element overflows or is constrained
2. Check for `height: 100vh` — change to `min-height: 100vh`
3. Check for `overflow: hidden` on containers — remove or change to `overflow: visible`
4. Check for `max-width` / `max-height` on content elements — remove restrictive constraints
5. Use flexbox (`display: flex; flex-direction: column`) for flexible sizing
6. For 50/50 grid layout: use `grid-template-columns: 1fr 1fr` with `gap: 32px`

## Files to check

- `public/styles.css` — main stylesheet (4225+ lines)
- `public/styles-fixed.css` — responsive overrides
- `public/index.html` — main player page
- `public/song.html` — song overlay
- `public/lyrics-text.html` — lyrics overlay

## Design language reference

- Card background: #181818 (control.html) / #282828 (modal)
- Input background: `rgba(255,255,255,0.06)`
- Spacing: 16px (compact)
- Progress bar: 4px height
- Buttons: border + subtle hover, not solid backgrounds
- Modal z-index: 2000
