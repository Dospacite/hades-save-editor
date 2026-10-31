# Hades Save Editor

Edit Hades and Hades II save files in your browser at [hadessaveeditor.app](https://hadessaveeditor.app/).

Your save never leaves your machine. The page reads the `.sav` file, lets you change resources, fish, Arcana, keepsakes, weapons, familiars, vows, incantations and other values, then hands you back a new file with a valid checksum. The Advanced tab can edit any value in the save. Nothing is uploaded.

Back up your save before you replace it. The editor checks every edit, but a broken save costs you a run history you can't get back.

## Supported versions

- Hades, save versions 1 to 16 (16 is the released game; older ones are from early access)
- Hades II, save versions 17 and 18

Each version has its own header layout, taken from the game's own load code. The editor writes a save back in the version it came in.

The editor keeps values it doesn't show. Unknown keys, legacy fields and the Hades II cheat flag above the 16-bit version number all survive a round trip.

Hades II checks some values every time it saves. If one is past its limit, for example more than 499,888 Bones or an Arcana card above rank III, the game marks the save as cheated, and the mark stays on later saves. The editor warns you before an edit crosses one of these limits. Hades has no such check.

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
| `public/js/save-codec.js` | Header layout for every save version, LZ4 blocks, LuaBin encoding, checksums and game detection |
| `public/js/cheat-limits.js` | The values Hades II checks for cheating when it saves |
| `public/js/editor-data.js` | The fields the editor shows for each game |
| `public/js/hades2-game-data.js` | Hades II items read from the installed game. Generated, don't edit |
| `public/js/field-logic.js` | Rank pickers, Fear and Grasp totals, and helpers for the Advanced tab |
| `public/js/file-access.js` | Remembered folder handles and the folder-upload fallback |
| `public/js/editor-search.js` | Search across categories |
| `public/js/main.js` | Upload, rendering, editing, reset and download |
| `public/js/lz4.js`, `public/js/adler32.js` | Vendored libraries, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) |
| `public/assets/items/` | Item icons taken from the games |
| `example_save_files/` | Real saves from both games, used by the round-trip tests |
| `scripts/` | Build checks, the dev server, and the game data scripts |
| `test/` | Tests run by `node --test` |

### Updating after a game patch

Most Hades II lists come from the installed game: keepsakes, Arcana, weapons and aspects, tools, familiars, vows, incantations, rank badges, achievements and the notes in the Advanced tab.

```sh
npm run update-game-data   # rewrites public/js/hades2-game-data.js and lists what changed
npm run audit-game         # writes reports/hades2-audit.md
```

`update-game-data` reads the game's Lua scripts and English text. New resources show up in the Resources tab under "Other" until someone sorts them into a group in `editor-data.js`. It also lists items that have no icon yet.

`audit-game` compares the editor with the game and with the example saves, plus any local saves it finds. The report lists fields that are out of date and every save value without a dedicated field, sorted by how much it's worth adding. `reports/hades2-game-data.json` has the same data for scripts. The rules that sort keys live in `scripts/lib/hades2-rules.js`. The `reports/` folder isn't committed.

Both scripts look for the game in the usual Steam folders. Pass `--game-dir <path>` or set `HADES2_DIR` if yours is elsewhere. `audit-game` also takes `--save <file>` and `--no-local-saves`.

### Adding a field

Fields live in `public/js/editor-data.js`. Get the internal name from the game's Lua scripts, for example `ResourceData.lua` in Hades II, and the display name from the English `.sjson` text files. Put the icon in `public/assets/items/<game>/`, then run `npm run build` to catch a wrong path.

Hades II lists that come from the game data need no edits here: rerun `npm run update-game-data` instead. Game patches add and rename items, so pull requests that catch up with a new patch are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

[zsennenga/hades_save_editor](https://github.com/zsennenga/hades_save_editor) by zsennenga inspired this project.

## License

The code is MIT licensed, see [LICENSE](LICENSE). The bundled libraries keep their own licenses, listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Hades and Hades II belong to Supergiant Games. The item icons in `public/assets/items/` and the example saves are game data and are not covered by the MIT license. This is a fan project, not affiliated with or endorsed by Supergiant Games.
