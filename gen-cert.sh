#!/bin/sh
# Creates (once) a local CA and issues a server certificate for TLS_SAN. Persisted in TLS_DIR.
# The CA stays the same across restarts/SAN changes, so devices only need to trust it once.
set -e
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
DIR="${TLS_DIR:-/certs}"
SAN="${TLS_SAN:-localhost,127.0.0.1}"
mkdir -p "$DIR"
cd "$DIR"

if [ ! -f ca.key ] || [ ! -f ca.crt ]; then
    echo "[WebProxy] creating local CA in $DIR"
    openssl genrsa -out ca.key 2048 2>/dev/null
    openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
        -subj "/CN=WebProxy Local CA" \
        -addext "basicConstraints=critical,CA:TRUE" \
        -addext "keyUsage=critical,keyCertSign,cRLSign" \
        -out ca.crt
fi

need=0
{ [ -f tls.crt ] && [ -f tls.key ]; } || need=1
[ "$(cat san.txt 2>/dev/null)" = "$SAN" ] || need=1
openssl x509 -checkend 2592000 -noout -in tls.crt >/dev/null 2>&1 || need=1

if [ "$need" = 1 ]; then
    list=""
    oldifs="$IFS"; IFS=','
    for raw in $SAN; do
        v=$(echo "$raw" | tr -d ' ')
        [ -n "$v" ] || continue
        case "$v" in
            *[!0-9.]*) case "$v" in *:*) e="IP:$v" ;; *) e="DNS:$v" ;; esac ;;
            *) e="IP:$v" ;;
        esac
        list="${list:+$list,}$e"
    done
    IFS="$oldifs"
    echo "[WebProxy] issuing server certificate for: $list"
    cat > ext.cnf <<EXT
subjectAltName=$list
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
EXT
    openssl genrsa -out tls.key 2048 2>/dev/null
    openssl req -new -key tls.key -subj "/CN=WebProxy" -out tls.csr
    openssl x509 -req -in tls.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
        -out tls.crt -days 397 -sha256 -extfile ext.cnf 2>/dev/null
    rm -f tls.csr ext.cnf
    printf '%s' "$SAN" > san.txt
fi

# public copy of the CA certificate (not the key) so devices can download and install it
cp ca.crt "$APP_DIR/public/ca.crt"
