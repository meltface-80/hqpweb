# hqpwc

**A web controller for HQPlayer.** A small, modern controller for Signalyst HQPlayer: pick an instance, see what it
is doing, and change filters, modulator/dither, volume, mode and output rate from any
phone, tablet or browser.

**Status: pre-alpha.** It works against HQPlayer Desktop 5; Embedded is untested.
Design and measured protocol behaviour: [docs/design-v1.md](docs/design-v1.md).

It speaks HQPlayer's published control protocol (XML over TCP 4321), the one Signalyst
publishes as MIT-licensed source in the HQPlayer SDK. It doesn't play music: Roon, or
whatever else drives HQPlayer, keeps doing that.

> Not affiliated with, endorsed by, or supported by Signalyst. HQPlayer is a
> trademark of its owner, used here only to identify compatible software.

## What it does

- **Live status.** Output rate, mode, source rate, playback state, engine version.
- **Quick changes.** Nx and 1x filters, modulator/dither, volume, polarity, 20 kHz
  filter, adaptive volume.
- **Mode and output rate,** under "Advanced", along with convolution on/off and
  matrix profile selection. Both are switch-only: they're set up in HQPlayer itself.
- **Presets.** Named one-tap bundles of settings, shared by all instances. Each
  shows whether applying it is already active, a quick change, or a major one.
  Settings an instance can't take are skipped and listed.
- **Warnings before you pick.** Combinations HQPlayer's documented rules say won't
  play are marked (for example a filter that needs a whole-number ratio), and the
  app warns when an instance falls behind real time or answers slowly.
- **Every change is checked.** The app reads HQPlayer's settings back instead of
  trusting its "OK".
- **Automatic rollback.** If a change made during playback stops playback or leaves
  HQPlayer unable to keep up, the app puts the previous settings back. It remembers
  the combination and warns about it next time.
- **Undo** for the last change.
- **Volume safety.**
  - It is never raised by more than 6 dB in one step, and never above HQPlayer's
    own maximum.
  - An undo or rollback won't raise it either if someone else changed it in the
    meantime.

## Tested with

| HQPlayer | Platform | Status |
|---|---|---|
| Desktop 5.32 | macOS (Apple Silicon) | works, including SDM / DSD1024 |
| Desktop 5.35 | Linux (container, CUDA) | works, PCM |
| Desktop 5.28 | Linux (VM) | reads verified; changes untested |
| Desktop 6.x, Embedded, Windows | — | **untested**: reports welcome ([TESTING.md](TESTING.md)) |

The controller itself runs in Docker on Linux (verified twice from this README on a
fresh machine). Docker Desktop on macOS or Windows should work, but without
discovery (no host networking); add instances by address.

## Install (Docker)

You need **git** and **Docker** (with Compose), on a machine that can reach your
HQPlayer on TCP port 4321.

```sh
git clone https://github.com/statelycurmudgeon/hqplayer-web-controller.git
cd hqplayer-web-controller
docker compose up -d --build
```

Open `http://<this machine's IP>:4380` and go to **Settings → Instances**: press
**Scan now**, or add your HQPlayer by its address. That's it.

On a phone, "Add to Home Screen" gives you a full-screen app.

### Updating

Read [CHANGELOG.md](CHANGELOG.md) for upgrade notes first, then:

```sh
git pull
docker compose up -d --build
```

Your instances, presets and learned failures are kept (in a Docker volume).

### Options

Put these in a `.env` file next to `docker-compose.yml` (create it if needed), then
run `docker compose up -d`.

- **Opening it by a name instead of an IP**, e.g. `http://controller.home.arpa:4380`
  or through a reverse proxy: `ALLOWED_HOSTS=controller.home.arpa` (several names
  comma-separated). IP addresses always work. Names must be listed, which protects
  the app from malicious web pages on your network (DNS rebinding).
- **A different port:** `PORT=8080`.
- **Publishing on one interface only**, e.g. when a reverse proxy runs on the same
  machine: `BIND_ADDRESS=127.0.0.1`.

**Discovery.** Scan now finds HQPlayer on the same network segment using UDP
multicast, which needs Docker's **host networking** (Linux only). Without it, add
instances by address; everything else works. To turn it on, create
`docker-compose.override.yml`:

```yaml
services:
  controller:
    network_mode: host
    ports: !reset []
```

Multicast never crosses VLANs or routers, so instances elsewhere are always added by
address. The container must reach each instance on TCP 4321; across VLANs that may
need a firewall rule.

**Behind a reverse proxy** (Caddy, nginx, Traefik): forward the original `Host`
header (most do by default), list that name in `ALLOWED_HOSTS`, and don't buffer
`/api/instances/*/events` (a server-sent event stream; the app sends
`X-Accel-Buffering: no`).

**Config by file** (optional): the app keeps `instances.json`, `presets.json` and
`learned.json` in its volume. To copy them out or in:
`docker compose cp controller:/config ./config-backup` /
`docker compose cp ./config-backup/. controller:/config`. Hand-edit
`instances.json` only while the container is stopped; the format is in
[config/instances.example.json](config/instances.example.json).

### Security

The app has **no login**. Anyone who can reach it can change your HQPlayer settings,
just as anyone who can reach HQPlayer's port 4321 already can. Run it on a network
you trust, or put an authenticating proxy in front. Never expose it to the internet.

By default Docker publishes the port on every interface of the host; see
`BIND_ADDRESS` under Options to narrow that. With host networking, set
`HOST=127.0.0.1` in the override file's `environment` instead.

## How this was made

I built hqpwc working with an AI coding assistant (Claude, from Anthropic). I
couldn't have done it on my own. I tried hard to make it solid and secure:
- HQPlayer's behaviour comes from measurements on real instances, written down
  in [docs/design-v1.md](docs/design-v1.md), and the code says where something is
  measured and where it's a guess;
- there are automated tests, including a fake HQPlayer to test against;
- every change that could disturb playback is checked and rolled back if it fails;
- the code has had security reviews.

It will still have rough edges. I'd love your feedback, especially where it falls
short: open an issue (see [TESTING.md](TESTING.md)).

## Development

See [docs/development.md](docs/development.md). In short: Node 24, `npm install`,
`npm test`, and a fake HQPlayer server for working without a real one.
