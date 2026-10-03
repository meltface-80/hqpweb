# Development

## Stack

| Part     | Choice                    | Why                                                                                             |
| -------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| Runtime  | Node 24                   | Runs `.ts` directly (type stripping), so no build step for the backend. `tsc` only type-checks. |
| Backend  | `node:http`, no framework | About thirty routes; the only runtime dependency is the XML parser.                             |
| Frontend | Svelte 5 + Vite, as a PWA | Small bundles for phones (about 33 KB gzipped).                                                 |
| Tests    | Vitest                    | One runner for every package.                                                                   |
| XML      | fast-xml-parser           | Replies are small; attribute values stay strings, so numbers are converted on purpose.          |

Because of type stripping, source uses only erasable TypeScript: no `enum`, no
`namespace`, no constructor parameter properties. `tsconfig.base.json` enforces this.

## Layout

```text
packages/protocol   HQPlayer control protocol: client, request builders, reply parsers. No web deps.
packages/fake-hqp   Fake HQPlayer (and a fake Roon core) for tests and development.
apps/server         HTTP API: instances, change engine with rollback, presets, Roon link.
apps/web            The PWA.
tools/probe         Read-only Python probe for real instances (stdlib only).
tools/fixtures      Builds fake-hqp profiles from read-only captures.
tools/hooks         Git hooks that keep personal data out of history (see CLAUDE.md).
config/             instances.example.json. A real instances.json is git-ignored.
```

Workspace packages are named `@app/*` and are private.

## Running

```sh
npm install
npm test                    # unit and fake-server tests
npm run typecheck           # server and packages
npm run check -w apps/web   # Svelte type check
npm run format              # Prettier

npm run fake                # fake HQPlayer on 127.0.0.1:14321, realistic timings
npm run dev:server          # API on 127.0.0.1:4380
npm run dev:web             # UI on 127.0.0.1:5173, proxies /api to the API
```

With no `config/instances.json`, the dev API talks **only** to the fake on port 14321.
The fake refuses to listen on 4321, the real HQPlayer port, and tests refuse to
connect to 4321 or 9330 (a real Roon core). To use real instances, copy
`config/instances.example.json` to `config/instances.json`. Writes to a real
instance follow CLAUDE.md rule 3.

Fake options: `--profile desktop5-mac-sdm|desktop5-linux-pcm`, `--time-scale 0` (no
delays), `--source-rate 96000` (switches the in-use filter from 1x to Nx), and
`--discovery PORT` (answers UDP discovery; off by default).

## Remote development

Dev servers bind to `127.0.0.1`; keep it that way. To reach the dev UI from another
device, put something in front that you control, e.g. `tailscale serve --bg 5173`
(never `funnel`, which publishes to the internet), and list the name you use in
`ALLOWED_HOSTS` for both Vite and the API server. Don't commit that name.

## Request hardening

The API has no login (design §7), so it defends against the browser:

- it refuses any `Host` it doesn't know (IP literals are fine), which blocks DNS
  rebinding;
- writes must carry an `Origin` matching the request's host and port, or a listed
  name on its default port;
- bodies must be `application/json`, at most 16 KB, and are validated strictly;
- every response forbids framing (clickjacking), and pages get a CSP.

## The fake server's fidelity

Profiles come from read-only captures of HQPlayer Desktop on macOS (SDM) and Linux
(PCM only), sanitised by `tools/fixtures/build_profile.py`. Each profile's
`provenance` says which lists are measured and which are borrowed. Every behaviour
is labelled in `packages/fake-hqp/src/fake.ts`.

- **Measured:** request and reply shapes; replies without `result`; convolution that
  says OK but does nothing; `ConfigurationLoad` refused; mode change swapping every
  list and restoring each mode's remembered filter and dither; the rate/modulator
  stall (OK, then state 3, then 0; `Play` ignored; resumes by itself once valid);
  timings (first `SetFilter` ~5 s, then ~0.3 s; `SetMode` ~2.9 s); volume formatting
  per platform; 1x vs Nx filter chosen by source rate; position in ~1 s steps.
- **Inferred**, chosen to be _unhelpful_ so client code can't lean on it:
  - an out-of-range index replies OK and changes nothing;
  - volume is clamped to `VolumeRange`;
  - a bad shaper stalls the same way a bad rate does;
  - the stall rule is widened from AHM7EC8B to all AHM…8B modulators below DSD1024.
- **Reported by HQPTuner (Embedded 6.0.4), unmeasured here:** a mode switch resets
  the rate to auto.

Not modelled: `Status` subscriptions, v6-only commands (the v5 profiles answer
"Unknown command", as real v5 does), and Embedded. The fake Roon core
(`fake-roon.ts`) is a minimal WebSocket server without fragmentation; enough for tests.
