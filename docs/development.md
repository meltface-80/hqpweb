# Development

## Stack

TypeScript end to end (design §9, decision 1).

| Part | Choice | Why |
|---|---|---|
| Runtime | Node 24 LTS | Runs `.ts` directly (type stripping), so no build step for the backend. `tsc` only type-checks. |
| Backend | `node:http`, no framework | Six routes don't need one. Runtime third-party packages: only the XML parser and its dependencies. |
| Frontend | Svelte 5 + Vite, as a PWA | Small bundles for phones; no framework runtime to speak of. |
| Tests | Vitest | One runner for every package. |
| XML | fast-xml-parser | Replies are small; attribute values stay strings, so numbers are converted on purpose. |

Because of type stripping, source uses only erasable TypeScript: no `enum`, no
`namespace`, no constructor parameter properties. `tsconfig.base.json` enforces this.

## Layout

```
packages/protocol   XML-over-TCP client, request builders, reply parsers. No web deps.
packages/fake-hqp   Fake HQPlayer server, plus profiles captured from real instances.
apps/server         HTTP API (read-only so far). The change engine goes here.
apps/web            PWA shell.
tools/probe         Read-only Python probe (stdlib).
tools/fixtures      Builds fake-hqp profiles from read-only captures.
config/             instances.example.json. The real instances.json is git-ignored.
```

Workspace packages are named `@app/*` and are private. The app has no product name
yet. Per CLAUDE.md, it must not lead with "HQPlayer".

## Running

```sh
npm install
npm test                 # all unit and fake-server tests
npm run typecheck

npm run fake             # fake HQPlayer on 127.0.0.1:14321, realistic timings
npm run dev:server       # API on 127.0.0.1:4380
npm run dev:web          # UI on 127.0.0.1:5173, proxies /api to the API
```

With no `config/instances.json`, the API talks **only** to the fake on port 14321. The
fake refuses to listen on 4321, the real HQPlayer port. To point at real instances,
copy `config/instances.example.json` to `config/instances.json`. Writes to a real
instance follow CLAUDE.md rule 3.

Fake options: `--profile desktop5-mac-sdm|desktop5-linux-pcm`, `--time-scale 0` (no
delays), `--source-rate 96000` (switches the in-use filter from 1x to Nx), and
`--discovery PORT` (answers UDP discovery; off by default).

## Remote access (Tailscale)

The app has no login (design §7). Set `ALLOWED_HOSTS` to the name clients use (for example the
internal DNS name).

**Request hardening:** the API refuses any `Host` it doesn't know, which blocks DNS
rebinding. It refuses writes that carry a cross-site `Origin`, and it accepts only
`application/json` bodies, up to 16 KB. Together these stop a web page elsewhere
on the network from driving it. In development, every server binds to `127.0.0.1`;
don't bind dev servers wider. To reach the dev UI from elsewhere, publish it to your
tailnet with `tailscale serve`:

```sh
tailscale serve --bg 5173                 # https://<machine>.<tailnet>.ts.net → 127.0.0.1:5173
export ALLOWED_HOSTS=<machine>.<tailnet>.ts.net
npm run dev:server & npm run dev:web
```

- **Who can reach it:** only your tailnet. Tailscale ACLs/grants decide which devices,
  and nothing listens on the LAN.
- **HTTPS comes free.** A PWA needs it off `localhost` for its service worker.
- **Vite rejects unknown `Host` headers,** so the tailnet name goes in
  `ALLOWED_HOSTS`. Don't commit it. The API server checks the same list (next section).
- **Identity headers.** `tailscale serve` also adds `Tailscale-User-Login` headers. A
  later version could use them as a lightweight identity, without its own login.

Use `serve`, never `funnel`: funnel publishes to the internet.

## Deployment

The app is fully usable with nothing in front of it. In the container, set
`HOST=0.0.0.0` (the API's bind address), mount `config/`, and put it on a network
that only trusted clients can reach. Internal-only HTTPS through a reverse proxy is
the expected shape. Adding auth at the proxy is optional and up to the operator
(design §7). Set `ALLOWED_HOSTS` to the name clients use (for example the
internal DNS name).

**Request hardening:** the API refuses any `Host` it doesn't know, which blocks DNS
rebinding. It refuses writes that carry a cross-site `Origin`, and it accepts only
`application/json` bodies, up to 16 KB. Together these stop a web page elsewhere
on the network from driving it.

## The fake server's fidelity

Profiles come from read-only captures (2026-10-02) of Desktop 5.32.5 (macOS, SDM) and
5.35.10 (Linux, PCM only), sanitised by `tools/fixtures/build_profile.py`. Each
profile's `provenance` says which lists are measured and which are borrowed.

Every behaviour is labelled in the code, in `packages/fake-hqp/src/fake.ts`.

- **Measured:** request and reply shapes; replies without `result`; convolution that
  says OK but does nothing; `ConfigurationLoad` refused; mode change swapping every
  list and restoring each mode's remembered filter and dither; the rate/modulator
  stall (OK, then state 3, then 0; `Play` ignored; resumes by itself once valid);
  timings (first `SetFilter` ~5 s, then ~0.3 s; `SetMode` ~2.9 s); volume formatting
  per platform; 1x vs Nx filter chosen by source rate.
- **Inferred**, chosen to be *unhelpful* so client code can't lean on it:
  - an out-of-range index replies OK and changes nothing;
  - volume is clamped to `VolumeRange`;
  - a bad shaper stalls the same way a bad rate does;
  - the stall rule is widened from AHM7EC8B to all AHM…8B modulators below DSD1024.
- **Reported by HQPTuner (Embedded 6.0.4), unmeasured here:** a mode switch resets
  the rate to auto.

Not modelled yet: `Status` subscriptions, convolution or matrix profiles, v6-only
commands (the v5 profiles answer "Unknown command", as real v5 does), and Embedded.
