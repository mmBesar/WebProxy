# WebProxy

Self-hosted web proxy (CroxyProxy-style): open `http://SERVER_IP:8080`, type an address or a search, browse through the server.

Built on [Rammerhead](https://github.com/binary-person/rammerhead) (server-side rewriting, so it works over a plain IP with no HTTPS or domain), with a minimal Catppuccin Macchiato landing page. Multi-arch image (amd64 + arm64).

## Run

```bash
docker compose up -d
```

Open `http://SERVER_IP:8080`. Ports **8080 and 8081 must both be reachable** (8081 is Rammerhead's cross-domain port).

The landing page creates and remembers a session for each device automatically. It also fixes what you type: `Https://x.com` (phone auto-capitalization), bare `x.com`, and plain search terms (sent to DuckDuckGo) all work. IPs and `localhost` get `http://`.

## Security mode

The container refuses to start unless you pick one:

- `RH_ALLOW_OPEN=true`: no password. Only for a trusted home network, never exposed to the internet.
- `RH_PASSWORD=...`: the landing page shows a password field.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `RH_ALLOW_OPEN` | off | Run without a password |
| `RH_PASSWORD` | none | Require a password |
| `PUBLIC_PORT` | `8080` | Port the browser uses (host side of the main port mapping) |
| `PUBLIC_CROSS_PORT` | `8081` | Port the browser uses for the cross-domain port |
| `PUBLIC_PROTOCOL` | `http:` | `https:` behind a TLS reverse proxy |
| `TRUST_PROXY` | off | Use `X-Forwarded-For` for the client IP (behind Caddy/nginx) |
| `RH_DISABLE_IP_LOCK` | off | Allow a session to be used from another IP |
| `LOG_LEVEL` | `info` | `disabled`, `debug`, `traffic`, `info`, `warn`, `error` |
| `LOG_STATUS` | off | Log what the proxy answered the browser (status, `finished` or `CUT-OFF`, bytes, ms) for requests matching `LOG_STATUS_MATCH`, plus every status >= 400. Query strings are not logged |
| `LOG_STATUS_MATCH` | `googlevideo\|youtubei\|/api/stats` | Regex of request URLs to log |

If you remap ports (e.g. `8118:8080`, `8228:8081`), set `PUBLIC_PORT=8118` and `PUBLIC_CROSS_PORT=8228`.
With bind mounts instead of named volumes, `chown 1000:1000` the host folders (the container runs as `node`).

## Notes

- Google logins don't work (upstream limitation). Heavy sites like YouTube can be flaky.
- Sessions live in the `sessions` volume and are deleted after 3 days of inactivity; the page makes a new one automatically.

## Updating upstream

The Dockerfile pins a tested Rammerhead commit (`RAMMERHEAD_REF`). Change the hash and push; CI rebuilds the image.

## CI

`.github/workflows/build.yml` builds on push to `main` (and `v*` tags, or manually) and pushes `ghcr.io/mmbesar/webproxy` with tags `latest` and `sha-<short>`.
