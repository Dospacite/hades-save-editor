# Hades Save Editor

A dependency-free, single-page editor for Hades and Hades II save files. Files are parsed, edited, validated, and downloaded entirely in the browser.

## Development

```sh
npm install
npm test
npm run dev
```

`npm run build` validates the JavaScript, page assets, and every catalog icon. Firebase Hosting serves `public/` directly, so there is no bundle step.

## Structure

- `public/js/save-codec.js` — binary save and LuaBin codec, LZ4 handling, checksums, and game/version detection
- `public/js/editor-data.js` — field catalog for both games
- `public/js/file-access.js` — remembered File System Access handles and folder-upload fallback
- `public/js/editor-search.js` — cross-category search and category selection
- `public/js/main.js` — upload, rendering, editing, reset, and download controller
- `public/assets/items/` — resource, fish, Arcana, and keepsake art extracted from the installed games
- `test/` — codec round trips, edit validation, file selection, search, and asset checks

The codec supports the current Hades version 16 layout and Hades II versions 17 and 18. Hades II save flags stored above the 16-bit version number are preserved.

## Game-data audit

The catalog was checked on 2026-08-03 against the installed game data, including:

- Hades `FishingData.lua` and English `HelpText.en.sjson`
- Hades II `ResourceData.lua`, `KeepsakeData.lua`, `MetaUpgradeData.lua`, and English SJSON text
- The Hades II version 18 save-header layout in the shipped executable/debug symbols

Unknown and legacy values in a loaded save are preserved even when they are not shown in the editor.

## Save-folder access

On supported Chromium browsers, **Open save folder** stores the user-approved directory handle in IndexedDB and reopens the newest `Profile*.sav` file from that folder. Browsers require the user to grant access; the site cannot open an arbitrary operating-system path without approval. Firefox and Safari use the directory-upload fallback, and direct `.sav` selection remains available everywhere.

Default save locations:

- Windows — `C:\Users\<user>\Documents\Saved Games\Hades\` and `%USERPROFILE%\Saved Games\Hades II\`
- macOS — `~/Library/Application Support/Supergiant Games/Hades` and `~/Library/Application Support/Supergiant Games/Hades II`
- Steam Deck / Linux with Proton — under Steam's `steamapps/compatdata/<game-id>/pfx/drive_c/users/steamuser/`; Hades II uses `Saved Games/Hades II/`

References: [File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access), [directory input fallback](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/webkitdirectory), [Hades save locations](https://www.supergiantgames.com/faqs/hades/), and [Hades II save locations](https://www.supergiantgames.com/faqs/hades-ii/).

This project was inspired by `hades_save_editor` by zsennenga.
