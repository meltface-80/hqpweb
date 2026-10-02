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

You need:

- a machine that can reach each HQPlayer instance on **TCP port 4321**;
- **git**, **Docker** and **Docker Compose**;
- a user that can run `docker` (root, `sudo`, or membership of the `docker` group).

1. Get the code:

   ```sh
   git clone https://github.com/statelycurmudgeon/hqplayer-web-controller.git web-controller
   cd web-controller
   ```

2. Tell it about your HQPlayer instances. You can skip this step and add them later
   in the app's Settings instead:

   ```sh
   cp config/instances.example.json config/instances.json
   ```

   Edit `config/instances.json`, replacing the example addresses:

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

   The app also writes into this folder (`learned.json`, and instances you add in
   Settings), so it must be writable by the container's user, uid 1000. If `id -u`
   prints anything other than 1000, run:

   ```sh
   sudo chown -R 1000:1000 config
   ```

3. Set the name you'll open it at, in a `.env` file next to `docker-compose.yml`:

   ```sh
   echo 'ALLOWED_HOSTS=controller.home.arpa' > .env
   ```

   Use exactly what you'll type in the browser's address bar: a hostname or an IP
   address (put IPv6 addresses in brackets, e.g. `[2001:db8::5]`). Separate several
   with commas. The app refuses requests addressed to any other name, which protects
   it from malicious web pages on your network. `localhost` and `127.0.0.1` always
   work. To use a port other than the default 4380, add `PORT=…` to `.env`.

4. Start it:

   ```sh
   docker compose up -d --build
   ```

   Open `http://<that name>:4380/`. Behind a reverse proxy, it's just the proxy's URL,
   e.g. `https://<that name>/`. `docker compose ps` shows `healthy` within a minute.

5. On a phone, use "Add to Home Screen" to get a full-screen app.

### Updating

Check [CHANGELOG.md](CHANGELOG.md) for upgrade notes first. Some updates change
defaults, such as the port. Then:

```sh
git pull
docker compose up -d --build
```

Your `config/` folder is kept.

### Networking notes

- **Reachability.** The container must reach every instance on TCP 4321. Across
  VLANs or subnets you may need a firewall rule.
- **Discovery** finds HQPlayer instances on the same network segment, using UDP
  multicast. Multicast doesn't cross VLANs or routers, so add other instances by hand
  in Settings, or in `instances.json`. In Docker, discovery needs **host
  networking** (Linux only). Create `docker-compose.override.yml` next to
  `docker-compose.yml`:

  ```yaml
  services:
    controller:
      network_mode: host
      ports: !reset []
  ```

  Then run `docker compose up -d`. The app is then on port 4380 (or your `PORT`) of the host itself.
  Without host networking everything else works: you add instances by hand.
- **Instances added in Settings** are saved to `config/instances.json`. Stop the
  container before editing that file by hand.
- **Behind a reverse proxy** (Caddy, nginx, Traefik):
  - forward the original `Host` header, which most do by default, and list that
    name in `ALLOWED_HOSTS`;
  - don't buffer `/api/instances/*/events`: it's a server-sent event stream. The
    app already sends `X-Accel-Buffering: no`.

### Security

The app has **no login**. Anyone who can reach it can change your HQPlayer settings,
just as anyone who can reach HQPlayer's port 4321 already can. Run it on a network
you trust, or put an authenticating proxy in front. Never expose it to the internet.

By default Docker publishes the port on every interface of the host. If a reverse
proxy on the same machine is the only client, publish it on loopback only by adding
`BIND_ADDRESS=127.0.0.1` to `.env`. (With host networking that setting doesn't
apply; set `HOST=127.0.0.1` in the override file's `environment` instead.)

## Development

See [docs/development.md](docs/development.md). In short: Node 24, `npm install`,
`npm test`, and a fake HQPlayer server for working without a real one.
