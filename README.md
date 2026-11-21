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
| `PUBLIC_PROTOCOL` | `http:` | `https:` when a TLS reverse proxy is in front. Ignored (always `https:`) when `TLS_ENABLED` is on |
| `RH_WORKERS` | one per CPU | Worker processes. `0` or `1` = single process. Forced to single process when `TLS_ENABLED` is on |
| `TRUST_PROXY` | off | Use `X-Forwarded-For` for the client IP (behind Caddy/nginx) |
| `RH_DISABLE_IP_LOCK` | off | Allow a session to be used from another IP |
| `QUICK_LINKS` | Google, DuckDuckGo, YouTube, Facebook | Landing-page buttons as `Name=url` pairs separated by commas or new lines (no commas inside a URL). A bare domain gets `https://`; write `http://...` for plain-HTTP sites. `""` hides them |
| `LOG_LEVEL` | `info` | `disabled`, `debug`, `traffic`, `info`, `warn`, `error` |
| `LOG_STATUS` | off | Log what the proxy answered the browser (status, `finished` or `CUT-OFF`, bytes, ms) for requests matching `LOG_STATUS_MATCH`, plus every status >= 400. Query strings are not logged |
| `LOG_BODY_MAX` | off | With `LOG_STATUS`: also log response bodies up to this many bytes as base64 (for decoding tiny error/control responses) |
| `FORWARD_PROXY_PORT` | off | Start the forward proxy on this port |
| `FORWARD_ALLOW` | private networks | Comma-separated CIDRs allowed to use it |
| `FORWARD_AUTH` | off | `user:password` for the forward proxy |
| `FORWARD_ALLOW_PRIVATE_DEST` | off | Allow reaching LAN/loopback addresses through it (not recommended) |
| `FORWARD_LOG` | off | Log each CONNECT/HTTP request |
| `POT_URL` | off | Base URL of the pot-provider service (enables the YouTube PO-token fix) |
| `POT_LOG` | first per session | `all` logs every injection |
| `LOG_STATUS_MATCH` | `googlevideo\|youtubei\|/api/stats` | Regex of request URLs to log |

If you remap ports (e.g. `8118:8080`, `8228:8081`), set `PUBLIC_PORT=8118` and `PUBLIC_CROSS_PORT=8228`.
With bind mounts instead of named volumes, `chown 1000:1000` the host folders (the container runs as `node`).

## HTTPS (built-in, local CA)

Plain `http://IP` is an insecure context for the browser, which disables some web APIs. For sites that need them, serve the proxy over HTTPS:

```yaml
environment:
  TLS_ENABLED: "true"
  TLS_SAN: "192.168.1.50, webproxy.lan"   # every IP/hostname you type in the browser
volumes:
  - certs:/certs
```

On start the container creates a local CA and a server certificate for `TLS_SAN` (kept in `/certs`). Both ports (main and cross-domain) then speak HTTPS, and `PUBLIC_PROTOCOL` defaults to `https:`. Changing `TLS_SAN` reissues the server certificate and keeps the same CA, so devices don't need to reinstall anything.

**Install the CA once per device** (menu names vary): download `https://SERVER:PORT/ca.crt` (the landing page shows an "Install certificate" link; click through the warning once to get it), or run `docker compose cp webproxy:/certs/ca.crt .`.

- Chromium/Chrome: Settings, Privacy and security, Security, Manage certificates, Authorities, Import.
- Firefox: Settings, Privacy & Security, View Certificates, Authorities, Import.
- Android: Settings, Security, Encryption & credentials, Install a certificate, CA certificate.

With built-in TLS the proxy runs as a single process, because Rammerhead's worker load balancer has to read plaintext HTTP to route requests and cannot sit in front of TLS. That is fine for a handful of users. To keep workers, terminate TLS in a reverse proxy instead and leave `TLS_ENABLED` off.

Keep the `certs` volume private: `ca.key` can mint certificates that every device trusting the CA will accept.

## Forward proxy (recommended for YouTube and heavy sites)

Set `FORWARD_PROXY_PORT=3128` and publish that port. Then give a device the proxy address: **`SERVER_IP` port `3128`**. The device's own browser does all the work (so YouTube, Google, Facebook see a genuine browser), and the server only passes encrypted bytes through, so there is no video processing on the server. The proxy looks up site names itself, so the device only needs the server's IP, and there are no certificates to install.

- Android: Settings, Wi-Fi, your network, Advanced (or the pencil), Proxy: Manual, hostname = server IP, port = 3128.
- Firefox: Settings, General, Network Settings, Manual proxy configuration, HTTP Proxy = server IP, port 3128, tick "Also use this proxy for HTTPS".
- Chrome/Chromium and most system tools use the operating system's proxy setting.

Safety: only private networks may use it (`FORWARD_ALLOW`), it refuses to connect to private/loopback addresses and port 25, and `FORWARD_AUTH` adds a login. Never expose port 3128 to the internet.

## YouTube through the web proxy page

(The PO-token injection below did not stop YouTube from rejecting the proxied page in testing, so use the forward proxy above for YouTube.)

YouTube's streaming servers ask the page to prove it is a real browser (a "PO token"). Through any rewriting proxy that proof fails and playback is cut after ~30-45 s (or on the first seek). WebProxy fixes this: the `pot-provider` service mints tokens and the proxy swaps one into the page's own stream requests (`POT_URL`). Nothing else about the request is changed, and if the provider is down the request is sent unchanged.

Check it at startup: `docker compose logs webproxy | grep POT` should show `self-test OK`. For YouTube's verdict on each stream request set `LOG_STATUS=true` and `LOG_STATUS_MATCH=googlevideo`; `sps=OK` is good, `PENDING`/`REJECTED` means YouTube still distrusts the token.

Do not publish the provider's port (4416); it is unauthenticated.

## Notes

- Google logins don't work (upstream limitation). Heavy sites like YouTube can be flaky.
- Sessions live in the `sessions` volume and are deleted after 3 days of inactivity; the page makes a new one automatically.

## Updating upstream

The Dockerfile pins a tested Rammerhead commit (`RAMMERHEAD_REF`). Change the hash and push; CI rebuilds the image.

## CI

`.github/workflows/build.yml` builds on push to `main` (and `v*` tags, or manually) and pushes `ghcr.io/mmbesar/webproxy` with tags `latest` and `sha-<short>`.
