# HQPlayer Web Controller

A small, modern web controller for Signalyst HQPlayer: pick an instance, see what it
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
- **Mode and output rate,** under "Advanced".
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

## Install (Docker)

You need a machine with Docker and Docker Compose that can reach each HQPlayer
instance on **TCP port 4321**.

1. Get the code:

   ```sh
   git clone <this repository's URL> web-controller
   cd web-controller
   ```

2. Tell it about your HQPlayer instances:

   ```sh
   mkdir -p config
   cp config/instances.example.json config/instances.json
   ```

   Edit `config/instances.json`:

   ```json
   {
     "instances": [
       { "id": "living-room", "name": "Living room", "host": "192.0.2.10", "port": 4321 },
       { "id": "office", "name": "Office", "host": "192.0.2.20", "port": 4321,
         "limits": { "maxPcmRate": 384000 } }
     ]
   }
   ```

   - `id`: lowercase letters, digits and dashes.
   - `name`: what the app shows.
   - `host`: the instance's IP address or hostname, as reachable from the Docker host.
   - `limits` (optional): `maxPcmRate` and/or `maxDsdRate` in Hz. Rates above them
     are never offered. Use this if your DAC accepts less than HQPlayer offers.

   The app also writes `learned.json` into this folder, so it must be writable by the
   container's user (uid 1000):

   ```sh
   sudo chown -R 1000:1000 config
   ```

3. Set the name you'll open it at, in a `.env` file next to `docker-compose.yml`:

   ```sh
   echo 'ALLOWED_HOSTS=controller.home.arpa' > .env
   ```

   Use the hostname in your browser's address bar, and separate several with commas.
   The app refuses requests addressed to any other name, which protects it from
   malicious web pages on your network. `localhost` and `127.0.0.1` always work. To
   use a port other than 8787, add `PORT=…` to `.env`.

4. Start it:

   ```sh
   docker compose up -d --build
   ```

   Open `http://<that name>:8787/`. Check it's healthy
   with `docker compose ps`, which shows `healthy` after about 10 s.

5. On a phone, use "Add to Home Screen" to get a full-screen app.

### Updating

```sh
git pull
docker compose up -d --build
```

Your `config/` folder is kept.

### Networking notes

- **Reachability.** The container must reach every instance on TCP 4321. Across
  VLANs or subnets you may need a firewall rule.
- **No automatic discovery yet.** Every instance goes in `instances.json`.
  (HQPlayer's discovery uses UDP multicast, which doesn't cross VLANs anyway.)
- **Behind a reverse proxy** (Caddy, nginx, Traefik):
  - forward the original `Host` header, which most do by default, and list that
    name in `ALLOWED_HOSTS`;
  - don't buffer `/api/instances/*/events`: it's a server-sent event stream. The
    app already sends `X-Accel-Buffering: no`.

### Security

The app has **no login**. Anyone who can reach it can change your HQPlayer settings,
just as anyone who can reach HQPlayer's port 4321 already can. Run it on a network
you trust, or put an authenticating proxy in front. Never expose it to the internet.

## Development

See [docs/development.md](docs/development.md). In short: Node 24, `npm install`,
`npm test`, and a fake HQPlayer server for working without a real one.
