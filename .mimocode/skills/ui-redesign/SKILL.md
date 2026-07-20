# UI Redesign

Redesign and beautify UI components in this Spotify Lyrics Player project.

## When to use

User requests: redesign, beautify, modernize, or refresh the look of pages or components.

## Design language (established)

- **Dark theme**: #181818 (control.html) / #282828 (modal)
- **Input background**: `rgba(255,255,255,0.06)`
- **Spacing**: 16px (compact, tighter than before)
- **Progress bar**: 4px height
- **Buttons**: border + subtle hover, not solid backgrounds
- **Modal z-index**: 2000

## Component inventory

| Component | DOM Location | JS Location | Notes |
|-----------|-------------|-------------|-------|
| lyrics-upload-modal | index.html:457 | lyrics-manager.js:73 | |
| lyrics-edit-modal | index.html:583 | lyrics-manager.js:232 | |
| user-lyrics-manager-content | index.html:472 | user-lyrics-manager.js:428 (dynamic) | |
| sync-modal | index.html:495 | script.js (sync control events) | |
| lyrics-search-modal | index.html:401 | lyrics-search.js:21 | |
| next-song-preview | index.html:28 | script.js: showNextTrackPreview | |
| lyrics-controls | index.html:200 | script.js:1834-1844 | |

## Overlay pages (OBS sources)

- lyrics-text.html, next.html, pre.html, song.html, image.html
- Use transparent background, minimal UI, no navigation bar
- Keep simple, focus on readability not decoration
- lyrics-text.html has karaoke word-by-word effect (`lyric-word.active` uses gradient text fill)

## Redesign procedure

1. Read current component HTML/CSS
2. Apply design language (dark theme, compact spacing, border buttons)
3. Ensure no forced viewport constraints (use min-height, flexbox)
4. Test for scrollbar overflow
5. Keep overlays minimal for OBS use

## Prototype patching pattern

Frontend extends `SpotifyLyricsPlayer` via `SpotifyLyricsPlayer.prototype.*` in separate JS files loaded sequentially. New features should follow this pattern.
