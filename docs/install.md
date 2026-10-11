# Installing and running hqpweb

The [README](../README.md#install) has the quick start. This page has the rest: where your
settings live, the ports it needs, options, reverse proxies, running without Docker, and
what to check when something doesn't work.

## What you need

- **Docker** on a machine that can reach HQPlayer over the network: a NAS, a Raspberry
  Pi 4 or 5, a home server, or the HQPlayer machine itself. The image runs on amd64 and
  arm64.
- **HQPlayer running**, Desktop or Embedded. hqpweb talks to it on its control port
  (TCP 4321).

## Install

**With Docker Compose** (recommended): save this as `docker-compose.yml` in a new
folder, then run `docker compose up -d` there.

```yaml
name: hqpweb
services:
  controller:
    image: ghcr.io/statelycurmudgeon/hqpweb:latest
    container_name: hqpweb
    restart: unless-stopped
    init: true
    ports:
      - "4380:4380"
    volumes:
      - config:/config # your HQPlayers, presets and what hqpweb has learned
volumes:
  config:
```

The repository's [docker-compose.yml](../docker-compose.yml) is the same, plus the
[options](#options) below; `curl -fsSLO https://raw.githubusercontent.com/statelycurmudgeon/hqpweb/main/docker-compose.yml`
fetches it.

**With `docker run`** (e.g. for Synology, Unraid or Portainer):

```sh
docker run -d --name hqpweb --restart unless-stopped --init \
  -p 4380:4380 -v hqpweb_config:/config \
  ghcr.io/statelycurmudgeon/hqpweb:latest
```

Then open `http://<that machine's address>:4380` and add your HQPlayer in **Settings →
HQPlayer** (leave the name blank to use HQPlayer's own), or press **Scan now** if
[discovery](#discovery) is on. On a phone, "Add to Home Screen" makes it a full-screen
app.

**From source:** clone the repository and run
`docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.

## Updating, pinning and rolling back

- **Update** with Compose: `docker compose pull && docker compose up -d`. With
  `docker run`: `docker pull ghcr.io/statelycurmudgeon/hqpweb:latest`, then
  `docker rm -f hqpweb` and run the same command again. Your settings are in the
  volume, so they're kept.
- **Before updating**, skim [CHANGELOG.md](../CHANGELOG.md). Settings → About shows the
  version and commit you're running; an open page offers to reload when the server has
  been updated.
- **Pin a release:** use its tag instead of `latest`, e.g.
  `ghcr.io/statelycurmudgeon/hqpweb:0.1.0-beta.5`, or `HQPWEB_TAG=0.1.0-beta.5` in a
  `.env` file next to the repository's `docker-compose.yml`.
- **Roll back** the same way: pin the release you had before. Settings files carry a
  format number. An older hqpweb reading files from a newer one says so in its log,
  and may drop settings it doesn't know about when it next saves. So
  [back up](#back-up-and-move) before going back.

## Where your settings live

**On the server, in `/config`** (the `config` volume), one JSON file each. They're
plain text, and hqpweb rewrites them as you use it:

| File             | What's in it                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `instances.json` | Your HQPlayers: name, address, named DACs, your guide answers, the restart volume cap       |
| `presets.json`   | Presets                                                                                     |
| `learned.json`   | Combinations that failed here and how fast others ran (the filter sort and warnings use it) |
| `history.json`   | History: every change, here or elsewhere                                                    |
| `roon.json`      | The Roon core's address and the pairing Roon approved (only if you switch Roon on)          |

**In each browser**, not on the server: theme, volume step,
the filter sort and how long load results count, the meter view and its timing nudge.
A new phone starts with the defaults.

### Back up and move

With the container running:

```sh
docker cp hqpweb:/config ./hqpweb-config-backup
```

To restore or move to another machine: stop the container, copy the folder's files
back into `/config` (`docker cp ./hqpweb-config-backup/. hqpweb:/config`), and start
it again.

### A folder instead of a volume

To keep the files in a folder you choose (`- ./config:/config` in Compose, or
`-v /path/to/config:/config`), make it writable by the container's user, `node`
(uid 1000): `sudo chown -R 1000:1000 ./config`. If it isn't writable, hqpweb still
works and rollback still works, but it can't save what it learns. Its log says
`… is not writable; learned failures won't be saved`.

## Network

| Direction    | Port                                  | What for                                               |
| ------------ | ------------------------------------- | ------------------------------------------------------ |
| In           | TCP 4380 (or `PORT`)                  | The app and its API, from your phone or browser        |
| Out          | TCP 4321 to HQPlayer                  | Control: every read and change                         |
| Out          | TCP 4322 to HQPlayer                  | The meter stream, only while a meter is open           |
| Out          | UDP 4321 to 239.192.0.199 (multicast) | Discovery (**Scan now**), only with host networking    |
| Out (option) | TCP 9330 to the Roon core             | Now playing and transport, only if you switch Roon on  |
| HQPlayer out | HTTPS to raw.githubusercontent.com    | The clap track, only when you line up the meter by ear |
| HQPlayer in  | TCP 4380, from HQPlayer to hqpweb     | The same track, if HQPlayer can't reach GitHub         |

hqpweb needs nothing from the internet. Links to sources open in your browser. Lining the
meter up by ear is the one exception: HQPlayer's machine fetches the clap track from
GitHub, or from hqpweb itself when it can't.

## Options

The repository's [docker-compose.yml](../docker-compose.yml) reads these from a `.env`
file next to it (then `docker compose up -d`). With the short example or `docker run`:
pick the version in the image name, the address and port in the port mapping
(`127.0.0.1:8080:4380`), and set the rest as environment variables (`environment:` or
`-e`).

| Variable        | Default                | Use                                                                                                    |
| --------------- | ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `HQPWEB_TAG`    | `latest`               | Image version to run, e.g. `0.1.0-beta.5` to stay on a release.                                        |
| `PORT`          | `4380`                 | Port the app listens on.                                                                               |
| `BIND_ADDRESS`  | `0.0.0.0`              | Interface to publish on, e.g. `127.0.0.1` behind a local proxy.                                        |
| `ALLOWED_HOSTS` | (none)                 | Host names you open it by, comma-separated (IP addresses always work). Needed for any name, any proxy. |
| `DISCOVERY`     | on                     | `off` stops hqpweb looking for HQPlayers on the network.                                               |
| `HOST`          | `0.0.0.0` in the image | Address the server binds inside the container (or on the machine, without Docker).                     |
| `CONFIG_DIR`    | `/config` in the image | Where the settings files live.                                                                         |

### Discovery

**Scan now** sends a multicast query, so it needs host networking (Linux only) and
only finds HQPlayers on the same network segment. Otherwise add them by address. To
turn it on, create `docker-compose.override.yml`:

```yaml
services:
  controller:
    network_mode: host
    ports: !reset []
    # BIND_ADDRESS doesn't apply with host networking; limit it here instead:
    # environment: { HOST: 127.0.0.1 }
```

## Behind a reverse proxy

Three things matter:

1. **List the name in `ALLOWED_HOSTS`, and pass the `Host` header through.** With the
   name missing, nothing loads ("host … not allowed"). With `Host` not passed through,
   pages load but changes can be refused ("cross-origin request refused").
2. **Don't buffer the two live streams:** `/api/instances/<id>/events` (now playing)
   and `/api/instances/<id>/meter` (the meters). hqpweb sends `X-Accel-Buffering: no`,
   which nginx honours; other proxies may need it set.
3. **Allow long-lived connections** on those two paths: they stay open for as long as
   the page does.

**nginx:**

```nginx
location / {
  proxy_pass http://127.0.0.1:4380;
  proxy_set_header Host $host;
  proxy_http_version 1.1;
  proxy_read_timeout 1h; # the live streams stay open
}
```

**Caddy:**

```caddy
hqpweb.example.com {
  reverse_proxy 127.0.0.1:4380 {
    flush_interval -1
  }
}
```

There's **no login**. If the proxy faces anything but your own network, put
authentication in front of it (see [Security](../README.md#security)).

## Without Docker

You need Node.js 24 or newer.

```sh
git clone https://github.com/statelycurmudgeon/hqpweb.git && cd hqpweb
npm ci
npm run build -w apps/web
NODE_ENV=production HOST=0.0.0.0 CONFIG_DIR=./config STATIC_DIR=apps/web/dist \
  node apps/server/src/main.ts
```

Without `NODE_ENV=production`, it starts in development mode, talking only to a fake
HQPlayer ([docs/development.md](development.md)). Without `HOST`, it listens only on
this machine (127.0.0.1).

## When something doesn't work

Start with the log: `docker logs hqpweb` (or the terminal, without Docker).

- **"host … not allowed; add it to ALLOWED_HOSTS"** (nothing loads) or **"cross-origin
  request refused"** (changes fail): you opened the app by a name, or through a proxy,
  that isn't in `ALLOWED_HOSTS`, or a proxy isn't passing `Host` through
  ([Behind a reverse proxy](#behind-a-reverse-proxy)). Add the name and restart.
  Opening it by IP address always works.
- **HQPlayer shows as not answering:** check the address in Settings → HQPlayer, that
  HQPlayer is running, and that the hqpweb machine can reach it on TCP 4321 (a
  firewall, or a different VLAN). `nc -vz <hqplayer-address> 4321` from the hqpweb
  machine tells you.
- **"No meter from this HQPlayer"** on the strip: hqpweb can't reach the meter port,
  TCP 4322 on the HQPlayer machine (the control port + 1). If it connects but the meter
  stays still, HQPlayer sends it only while playing. Measured on HQPlayer Desktop 5 and
  HQPlayer 6 Embedded (6.2.5).
- **Scan now finds nothing:** discovery needs host networking and the same network
  segment ([Discovery](#discovery)). Add the HQPlayer by address instead.
- **Roon shows nothing:** in Roon → Settings → Extensions, enable `hqpweb …`; the
  container must reach the core on TCP 9330; then pick the zone that feeds each
  HQPlayer in Settings → Roon. Each install of hqpweb needs its own approval.
- **Settings gone after an update:** the container was recreated with a different
  volume. Compose's fixed project name (`name: hqpweb`) keeps it the same; with
  `docker run`, keep `-v hqpweb_config:/config`.
- **It forgets what failed:** the config folder isn't writable
  ([A folder instead of a volume](#a-folder-instead-of-a-volume)).

Still stuck? [Open an issue](https://github.com/statelycurmudgeon/hqpweb/issues) with
your HQPlayer version and platform, and what the log says.
