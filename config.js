'use strict';
// Overrides upstream src/config.js (Rammerhead merges ../config.js over its defaults).

const env = process.env;
const bool = (v) => ['1', 'true', 'yes', 'on'].includes(String(v || '').toLowerCase());

if (bool(env.LOG_STATUS)) require('./status-log.js');
if (env.POT_URL) require('./pot-inject.js');

const password = env.RH_PASSWORD || null;
if (!password && !bool(env.RH_ALLOW_OPEN)) {
    console.error(
        '[WebProxy] RH_PASSWORD is not set. Refusing to start an open proxy.\n' +
        '           Set RH_PASSWORD, or set RH_ALLOW_OPEN=true if you really want no password.'
    );
    process.exit(1);
}

// Ports the BROWSER uses to reach the proxy (what you map on the host / reverse proxy).
const publicPort = Number(env.PUBLIC_PORT || 8080);
const publicCrossPort = Number(env.PUBLIC_CROSS_PORT || 8081);
const tlsOn = bool(env.TLS_ENABLED);
const tlsDir = env.TLS_DIR || '/certs';
// With built-in TLS the public protocol is always https. PUBLIC_PROTOCOL is for a TLS reverse proxy in front.
const publicProtocol = tlsOn ? 'https:' : (env.PUBLIC_PROTOCOL || 'http:');
if (tlsOn && env.PUBLIC_PROTOCOL && env.PUBLIC_PROTOCOL !== 'https:') {
    console.warn('[WebProxy] TLS_ENABLED is set, so PUBLIC_PROTOCOL=' + env.PUBLIC_PROTOCOL + ' is ignored (using https:)');
}

// Workers: Rammerhead's load balancer reads the (plaintext) HTTP request to route by session, so it
// cannot sit in front of built-in TLS. With TLS on we run single-process. RH_WORKERS overrides the
// upstream default (one worker per CPU when there is more than one CPU); 0 or 1 = single process.
const os = require('os');
const path = require('path');
const cpus = os.cpus().length;
let workers = env.RH_WORKERS !== undefined && env.RH_WORKERS !== '' ? Math.max(0, Number(env.RH_WORKERS) || 0) : cpus;
let enableWorkers = env.RH_WORKERS !== undefined && env.RH_WORKERS !== '' ? workers > 1 : cpus !== 1;
if (tlsOn && enableWorkers) {
    console.warn('[WebProxy] built-in TLS cannot be used with the worker load balancer; running single-process');
    enableWorkers = false;
}
const RammerheadJSFileCache = require('./src/classes/RammerheadJSFileCache.js');

module.exports = {
    enableWorkers,
    workers,
    jsCache: new RammerheadJSFileCache(path.join(__dirname, 'cache-js'), 5 * 1024 * 1024 * 1024, 50000, enableWorkers),

    bindingAddress: '0.0.0.0',
    port: 8080,
    crossDomainPort: 8081,

    // Use whatever host the browser typed (IP or domain) so it works by plain IP.
    getServerInfo: (req) => ({
        hostname: new URL('http://' + req.headers.host).hostname,
        port: publicPort,
        crossDomainPort: publicCrossPort,
        protocol: publicProtocol,
    }),

    // Built-in HTTPS (both the main and the cross-domain port). Certificates come from gen-cert.sh.
    ssl: tlsOn
        ? { key: require('fs').readFileSync(tlsDir + '/tls.key'), cert: require('fs').readFileSync(tlsDir + '/tls.crt') }
        : null,

    password,
    restrictSessionToIP: !bool(env.RH_DISABLE_IP_LOCK),

    // Behind a reverse proxy (Caddy/nginx) the real client IP is in X-Forwarded-For.
    getIP: bool(env.TRUST_PROXY)
        ? (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
        : (req) => req.socket.remoteAddress,

    logLevel: env.LOG_LEVEL || 'info',
};
