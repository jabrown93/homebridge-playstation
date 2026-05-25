## Project context

Homebridge dynamic platform plugin that exposes PS4/PS5 consoles to HomeKit as Television accessories. The README warns the plugin is not actively maintained except for automated dependency updates — be conservative about scope; this is not a green field.

Heavy lifting (discovery, wake, standby, title control) is delegated to [`playactor`](https://github.com/dhleong/playactor). This plugin is a thin Homebridge adapter on top of it. Before adding logic that talks to a PlayStation, check whether playactor already exposes the primitive.

Node `^24.0.0` (see `.nvmrc` → `24`), ESM (`"type": "module"`) — local imports must include the `.js` extension even in `.ts` source. Homebridge engines: `^1.8.0 || ^2.0.0-beta.0`.

## Commands

- `npm run build` — clean + `tsc` to `dist/`
- `npm run typecheck` (alias `npm run tsc`) — type-check without emit
- `npm run lint` / `npm run lint:fix` — ESLint over `src/**.ts`
- `npm run format` — Prettier write; `npm run prettier` checks
- `npm run watch` — copies `test/hbConfig/config-template.json` → `config.json` if missing, builds, `npm link`s, then `nodemon` rebuilds and reruns Homebridge against `./test/hbConfig` on every `src/` change
- `npm test` — **no tests exist**; the script is a stub that exits 0. Do not assume test coverage.
- Releases are driven by `semantic-release` from Conventional Commits on `main` via `.github/workflows/release.yml`; do not bump `version` in `package.json` by hand.

Husky + lint-staged run `eslint --fix --max-warnings=0` and `prettier --write` on staged `*.{js,mjs,ts,json,md}`. Commitlint enforces Conventional Commits.

## Architecture

Entry point `src/index.ts` registers `PlaystationPlatform` under platform name `playstation` (see `src/settings.ts`).

`PlaystationPlatform` (`src/playstationPlatform.ts`):

- `DynamicPlatformPlugin`. On `didFinishLaunching` it iterates `playactor`'s `Discovery().discover()` async iterable and constructs one `PlaystationAccessory` per device.
- `configureAccessory` only stashes cached accessories into `existingAccessories`; the accessory class instead calls `api.publishExternalAccessories` directly, so consoles appear as **external accessories the user must add manually in the Home app** (this is by design — matches the README setup flow).

`PlaystationAccessory` (`src/playstationAccessory.ts`):

- Models the console as a `Service.Television` (category `TV_SET_TOP_BOX`), not a Switch, despite the README's "Switch service" wording.
- `setInterval(updateDeviceInformation, config.pollInterval ?? 15_000)` polls device state; on poll failure status is forced to `STANDBY` (assumed off).
- All console interactions go through a single `AsyncLock` keyed `'update'`. Reads use `pollLock*` timeouts; writes (`setOn`, `setTitleSwitchState`) use `writeLock*` timeouts (default 30s) and `setOn` passes `skipQueue: true` so power commands jump the queue. Preserve this locking discipline — concurrent playactor connections to the same device are unsafe.
- `setOn` calls `device.wake()` to turn on, but opens a full `device.openConnection({ socket: SOCKET_OPTIONS })` to send `connection.standby()` for power-off, and always closes the connection in `finally`. `getOn` is synchronous and returns the cached `deviceInformation.status` — it does not re-query.
- Title (app) launch: `config.apps` is mapped to HomeKit `InputSource` services with a placeholder `CUSAXXXXXX` at index 0. `setTitleSwitchState` calls `connection.startTitleId(...)`. Per `config.schema.json`, this does not work on PS5.

`src/cli.ts` is published as the `homebridge-playstation-login` bin: it walks discovered devices, prompts the user, and triggers playactor's auth flow (which opens a PSN URL and asks for a PIN). Credentials live in playactor's own config dir (`~/.config/playactor`), not in this repo.

`config.schema.json` is the source of truth for the Homebridge UI config form; `src/config.ts` mirrors it as a TypeScript interface. Keep the two in sync when adding options.

## Local dev loop

`npm run watch` is the intended inner loop. It runs a real Homebridge instance with config under `test/hbConfig/`. `test/hbConfig/config.json` is gitignored and seeded from `config-template.json` — edit it freely for local testing; don't commit it.

There is no automated test suite — manual verification via the watch loop or a real Homebridge install is the only safety net. State this explicitly when reporting completion of changes.
