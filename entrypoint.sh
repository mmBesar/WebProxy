#!/bin/sh
set -e
cd "$(dirname "$0")"
node gen-sites.js
case "$(echo "${TLS_ENABLED:-}" | tr 'A-Z' 'a-z')" in
    1|true|yes|on) sh ./gen-cert.sh ;;
esac
[ -n "$POT_URL" ] && node pot-selftest.js &
exec node src/server.js
