# Open Page Capture

Full-page, visible-area and selected-area screenshots for Chromium browsers (Chrome, Edge, Brave, Vivaldi, Opera).
No account, no paywall, no cloud. Everything, including OCR, runs on your device.

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this folder (the one containing `manifest.json`).
4. Pin the extension and click its icon.

Requires Chrome 116 or newer.

## Using it

Click the toolbar icon:

| Option | What it does |
|---|---|
| **Visible area** | Captures what is on screen now. |
| **Full page** | Scrolls and stitches the whole page. Fixed elements, and sticky ones while they are stuck to an edge, are hidden after the first frame (re-checked before every frame, since many sites only make a header sticky once you scroll) so they do not repeat. |
| **Selected area** | Drag any region. The page can be scrolled while you drag (mouse wheel, keyboard, or drag near an edge). Enter or the Capture button confirms, Esc cancels. |
| **History** | Your saved captures, with a Favourites section and search. |

After a capture the viewer opens: **Edit, Copy, Print, Save** (PNG / JPEG / GIF / PDF), star, delete, zoom.
Ctrl+C in the viewer copies the screenshot. In the editor Ctrl+C copies the saved image and only works when there are no unsaved changes.

* **Timed storage.** Captures are kept in the browser (IndexedDB) and auto-delete after 1 hour, 1 day, 7 days or 30 days
  (Settings > Storage). There is deliberately no "never". **Starred captures are never deleted**; un-starring one
  restarts its timer.
* **PDF with OCR.** Paper size (Full image / Letter / Legal / A4), orientation, smart page splitting (page breaks fall
  in gaps between lines), clickable links, URL/date stamp. With *Searchable PDF* on, the text on the page is
  recognised on-device (Tesseract) and laid invisibly over the image so it can be selected and searched.
* **Editor.** Pen, highlighter, line, arrow, rectangle, ellipse, text, pixelate/blur, crop; move/resize, undo/redo.
  Crop works like a photo editor: a frame starts at the image edges and you drag its edges or corners inwards (or drag inside to move it), then Apply (Enter). Save keeps you in the editor; Done saves and returns.
  Pixelate averages blocks of pixels, so hidden text cannot be recovered.
* **Evidence mode** (Settings > Capturing). Exports get a band with the URL, capture time with time zone and a SHA-256
  checksum of the pixels, also written into the file (PNG text chunk, PDF properties). Images are forced to lossless
  PNG. Use **Verify evidence** to re-check an exported PNG; edits made after capture are flagged.
* **Batch capture.** Paste a list of URLs; they are captured one at a time in a separate window and saved to history,
  optionally also downloaded as PNG/JPEG/PDF. Access to the listed sites is requested when you press Start.


## Appearance and keyboard shortcuts

**Theme.** Light, Dark or System (follows the browser/OS). Switch with the sun/moon/monitor button at the top of every
screen, or in Settings > Appearance. It is applied before the page paints, so there is no flash.

**Shortcuts.** Every task has a default key, and the in-app ones can be changed in Settings > Shortcuts (click a key,
press the new combination; Reset/Clear per task, Reset all). Conflicts inside a screen are refused. `Mod` is Ctrl, or
Command on a Mac.

Anywhere in the browser (change in `chrome://extensions/shortcuts`; Chrome allows only four default keys):

| Task | Default |
|---|---|
| Capture visible area | Alt+Shift+V |
| Capture full page | Alt+Shift+F |
| Capture selected area | Alt+Shift+S |
| Open Your captures | Alt+Shift+H |

While a capture started this way runs, the toolbar icon shows its progress (and a red `!` with the reason if it fails).

Viewer: Save `Mod+S`, Save as PNG/JPEG/GIF/PDF `Mod+Alt+1/2/3/4`, Copy `Mod+C`, Print `Mod+P`, Edit `E`, Favourite `F`,
Delete `Delete`, Your captures `H`, Zoom `+` `-` `0` `1`.
Editor: Save `Mod+S`, Save and finish `Mod+Enter`, Copy saved image `Mod+C`, Undo `Mod+Z`, Redo `Mod+Y`, tools
`V P H L A R O T B C`, Delete `Delete`, nudge with the arrow keys (Shift = 10 px), Apply crop `Enter`, Esc to cancel.
Your captures: Search `/`, Select `S`, Select all `Mod+A`, Favourite `F`, Download `Mod+S`, Delete `Delete`.

## Known limits

* Pages that can't be captured: `chrome://` pages, the Chrome Web Store, other extensions' pages, and the built-in
  PDF viewer. Local `file://` pages need "Allow access to file URLs" for the extension.
* Chrome allows about two screenshots per second, so a very long page takes a while.
* Captures are limited to about 100 megapixels / 32,000 px per side; larger pages are scaled down (the viewer says
  by how much). Scrolling stops at 60,000 CSS px.
* Full page captures the viewport width. Horizontally scrolling pages are only stitched sideways in Selected area mode.
* If a page scrolls inside one big container instead of the window, Full page detects and uses it. Selected area
  scrolls the window only.
* GIF export is a single frame with a 256-colour palette and is capped at 20 megapixels.
* The OCR text layer supports Latin-script text (PDF standard fonts). Other characters are skipped.
* Pages that rewrite themselves while scrolling, parallax or scroll-snap layouts can show seams.
* The browser blocks screenshots while the tab is not visible; keep the tab (or the batch window) in front.

## More OCR languages

English is bundled. To add one, put `<code>.traineddata.gz` (for example `deu.traineddata.gz` from the
`@tesseract.js-data/deu` package, "4.0.0_best_int" folder) into `vendor/tesseract/tessdata/`, then enter the code
(for example `eng+deu`) under Settings > PDF > OCR language.

## Layout

```
manifest.json            MV3 manifest
background/              service worker: capture pipeline, batch, expiry, export bridge
content/                 capture-helper.js (scroll/measure), selector.js (area selection overlay)
lib/                     db, settings, stitch engine, exporter, OCR, SHA-256, PNG metadata, UI helpers
popup/ viewer/ editor/ history/ options/ batch/ verify/ offscreen/   the screens
vendor/                  bundled third-party code (see THIRD_PARTY_NOTICES.md)
tests/ scripts/          Node tests and a reference checker
```

## Tests

```
npm install
npm test
```

These run in Node with a canvas shim: the stitching engine (pixel-exact against a simulated scrolling page), and the
exporter (PNG round trip, Evidence checksum and tamper detection, JPEG, GIF, PDF layouts and link annotations).
They do not drive a real browser.

## Privacy

No analytics and no network requests of its own. The only permission requested at runtime is access to the sites you
list in Batch capture. License: not chosen yet.
