# Hades Save Editor

Edit Hades and Hades II save files in your browser at [hadessaveeditor.app](https://hadessaveeditor.app/).

Your save never leaves your machine. The page reads the `.sav` file, lets you change resources, fish, Arcana, keepsakes and other values, then hands you back a new file with a valid checksum. Nothing is uploaded.

Back up your save before you replace it. The editor checks every edit, but a broken save costs you a run history you can't get back.

## Supported versions

- Hades, save version 16
- Hades II, save versions 17 and 18

The editor keeps values it doesn't show. Unknown keys, legacy fields and the Hades II flag bits above the 16-bit version number all survive a round trip.

## Finding your save

| Platform | Hades | Hades II |
| --- | --- | --- |
| Windows | `Documents\Saved Games\Hades\` | `%USERPROFILE%\Saved Games\Hades II\` |
| macOS | `~/Library/Application Support/Supergiant Games/Hades` | `~/Library/Application Support/Supergiant Games/Hades II` |
| Steam Deck and Linux (Proton) | `steamapps/compatdata/<game-id>/pfx/drive_c/users/steamuser/Documents/Saved Games/Hades/` | `steamapps/compatdata/<game-id>/pfx/drive_c/users/steamuser/Saved Games/Hades II/` |

Supergiant lists the same paths in its [Hades FAQ](https://www.supergiantgames.com/faqs/hades/) and [Hades II FAQ](https://www.supergiantgames.com/faqs/hades-ii/).

In Chrome and Edge, **Choose save folder** remembers the folder you pick and opens the newest `Profile*.sav` next time. The browser asks for permission first, and the page can't read any folder you didn't choose. Firefox and Safari don't support the [File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access), so they fall back to a [folder upload](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/webkitdirectory). Picking a single `.sav` file works in every browser.

## Development

You need Node.js 18 or newer. The project has no dependencies and no bundler. Firebase Hosting serves `public/` as it is.

```sh
npm test        # codec round trips and UI logic
npm run build   # syntax-checks the scripts and confirms every linked file and icon exists
npm run dev     # serves public/ at http://127.0.0.1:4173
```

Set `HADES_EDITOR_PORT` to use another port.

### Layout

| Path | Contents |
| --- | --- |
| `public/js/save-codec.js` | Save header, LZ4 blocks, LuaBin encoding, checksums and game detection |
| `public/js/editor-data.js` | The fields the editor shows for each game |
| `public/js/file-access.js` | Remembered folder handles and the folder-upload fallback |
| `public/js/editor-search.js` | Search across categories |
| `public/js/main.js` | Upload, rendering, editing, reset and download |
| `public/js/lz4.js`, `public/js/adler32.js` | Vendored libraries, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) |
| `public/assets/items/` | Item icons taken from the games |
| `example_save_files/` | Real saves from both games, used by the round-trip tests |
| `test/` | Tests run by `node --test` |

### Adding a field

Fields live in `public/js/editor-data.js`. Get the internal name from the game's Lua scripts, for example `ResourceData.lua` in Hades II, and the display name from the English `.sjson` text files. Put the icon in `public/assets/items/<game>/`, then run `npm run build` to catch a wrong path.

I last checked the catalog against the installed games on 2026-08-03. That covered Hades `FishingData.lua` and `HelpText.en.sjson`, plus Hades II `ResourceData.lua`, `KeepsakeData.lua`, `MetaUpgradeData.lua` and its English text. Game patches add and rename items, so pull requests that catch up with a new patch are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

[zsennenga/hades_save_editor](https://github.com/zsennenga/hades_save_editor) by zsennenga inspired this project.

## License

The code is MIT licensed, see [LICENSE](LICENSE). The bundled libraries keep their own licenses, listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Hades and Hades II belong to Supergiant Games. The item icons in `public/assets/items/` and the example saves are game data and are not covered by the MIT license. This is a fan project, not affiliated with or endorsed by Supergiant Games.
