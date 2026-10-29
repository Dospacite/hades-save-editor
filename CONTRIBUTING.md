# Contributing

Bug reports and pull requests are welcome.

## Reporting a bug

Say which game, which browser, and what happened. If a save fails to load or comes out broken, attach the `.sav` file. Saves only hold game progress, but look before you share one if that worries you.

## Pull requests

1. Run `npm run build` and `npm test`. CI runs both on every pull request.
2. Keep the site dependency-free. It loads plain scripts from `public/` with no build step, and it should stay that way.
3. Never drop data from a save. If the editor doesn't know a field, it must write it back unchanged. The round-trip tests in `test/save-codec.test.js` check this against the files in `example_save_files/`.
4. For new items, follow "Adding a field" in the [README](README.md).

Pull requests from this repository get a Firebase preview link. Pull requests from forks don't, because the preview needs deploy credentials. Run `npm run dev` to try your change locally.

By contributing you agree to license your work under the [MIT license](LICENSE).
