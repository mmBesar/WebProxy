# WebProxy

Self-hosted web proxy (CroxyProxy-style): open `http://SERVER_IP:8080`, type a URL, browse through the server.

Built on [Rammerhead](https://github.com/binary-person/rammerhead) (server-side rewriting, so it works over a plain IP with no HTTPS or domain). Wrapped as a multi-arch (amd64 + arm64) container with a Catppuccin Macchiato / Mauve theme.

## Run

```bash
cp .env.example .env      # set RH_PASSWORD
docker compose up -d
```

Open `http://SERVER_IP:8080`. Ports **8080 and 8081 must both be reachable** (8081 is Rammerhead's cross-domain port).

The container refuses to start without `RH_PASSWORD`, so it can't become an open proxy by accident. Set `RH_ALLOW_OPEN=true` to override.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `RH_PASSWORD` | none (required) | Password to create sessions |
| `PUBLIC_PORT` | `8080` | Port the browser uses (set if you remap the main port) |
| `PUBLIC_CROSS_PORT` | `8081` | Port the browser uses for the cross-domain port |
| `PUBLIC_PROTOCOL` | `http:` | `https:` when behind a TLS reverse proxy |
| `TRUST_PROXY` | off | Use `X-Forwarded-For` for the client IP (behind Caddy/nginx) |
| `RH_DISABLE_IP_LOCK` | off | Allow a session id to be used from other IPs |
| `LOG_LEVEL` | `info` | `disabled`, `debug`, `traffic`, `info`, `warn`, `error` |

Remapping ports (e.g. `9000:8080`, `9001:8081`) means setting `PUBLIC_PORT=9000` and `PUBLIC_CROSS_PORT=9001` too.

## Notes

- Google logins don't work (upstream limitation). Most other sites do.
- A session id is effectively a logged-in browser profile. Don't share it.
- Sessions and the JS cache live in named volumes (`sessions`, `cache-js`).

## Updating upstream

The Dockerfile pins a tested Rammerhead commit (`RAMMERHEAD_REF`). To update, change that hash and push; CI rebuilds the image.

## CI

`.github/workflows/build.yml` builds on push to `main` (and `v*` tags, or manually) and pushes `ghcr.io/mmbesar/webproxy` with tags `latest` and `sha-<short>`.
