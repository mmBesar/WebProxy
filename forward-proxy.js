'use strict';
// Plain HTTP/HTTPS forward proxy (CONNECT). The device's own browser does all the work (so YouTube etc. see a
// genuine browser); this only tunnels encrypted bytes. The proxy resolves site names itself, so a device that
// only knows this server's IP can still reach any site. Enable with FORWARD_PROXY_PORT.
const http = require('http');
const net = require('net');
const dns = require('dns');
const env = process.env;
const PORT = Number(env.FORWARD_PROXY_PORT || 0);
if (!PORT) process.exit(0);
const log = (m) => console.log(`[${new Date().toISOString()}] [FWD] ${m}`);
const verbose = ['1', 'true', 'yes', 'on'].includes(String(env.FORWARD_LOG || '').toLowerCase());
const allowPrivateDest = ['1', 'true', 'yes', 'on'].includes(String(env.FORWARD_ALLOW_PRIVATE_DEST || '').toLowerCase());
const auth = env.FORWARD_AUTH ? 'Basic ' + Buffer.from(env.FORWARD_AUTH).toString('base64') : null;
const IDLE_MS = Number(env.FORWARD_IDLE_SECONDS || 600) * 1000;

// ---- IPv4 CIDR helpers (IPv6 clients are matched only for ::1 and IPv4-mapped addresses)
const ip4 = (s) => { const p = s.split('.').map(Number); return p.length === 4 && p.every((x) => x >= 0 && x < 256) ? ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3] : null; };
const cidr = (c) => { const [a, b = '32'] = c.trim().split('/'); const base = ip4(a); if (base === null) return null; const bits = Number(b); const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0; return { base: (base & mask) >>> 0, mask }; };
const inAny = (addr, list) => { const n = ip4(addr); return n !== null && list.some((c) => ((n & c.mask) >>> 0) === c.base); };
const normalize = (a) => String(a || '').replace(/^::ffff:/i, '');
const PRIVATE = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16', '100.64.0.0/10'].map(cidr);
const ALLOW = (env.FORWARD_ALLOW ? env.FORWARD_ALLOW.split(',') : ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8']).map(cidr).filter(Boolean);
const clientAllowed = (a) => { a = normalize(a); return a === '::1' || inAny(a, ALLOW); };
const blockedDest = (a) => {
    if (allowPrivateDest) return false;
    a = normalize(a);
    if (a === '::1' || /^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a) || a === '::') return true;
    return inAny(a, PRIVATE) || a === '0.0.0.0';
};
// Resolve through the OS resolver (the server's DNS) and refuse private/loopback targets (also stops DNS rebinding).
const safeLookup = (hostname, options, cb) => dns.lookup(hostname, options, (err, addr, fam) => {
    if (err) return cb(err);
    const list = Array.isArray(addr) ? addr : [{ address: addr, family: fam }];
    for (const x of list) if (blockedDest(x.address)) return cb(Object.assign(new Error('blocked destination'), { code: 'EBLOCKED' }));
    cb(null, addr, fam);
});
const DENY_PORTS = new Set([25]);

function gate(req) {
    if (!clientAllowed(req.socket.remoteAddress)) return [403, 'client not allowed'];
    if (auth && req.headers['proxy-authorization'] !== auth) return [407, 'proxy authentication required'];
    return null;
}
const refuse = (sock, [code, msg]) => {
    const extra = code === 407 ? 'Proxy-Authenticate: Basic realm="proxy"\r\n' : '';
    sock.end(`HTTP/1.1 ${code} ${msg}\r\n${extra}Content-Length: 0\r\nConnection: close\r\n\r\n`);
};

const server = http.createServer((req, res) => {          // plain http:// requests (absolute-URI form)
    const g = gate(req); if (g) { res.writeHead(g[0], g[1], g[0] === 407 ? { 'Proxy-Authenticate': 'Basic realm="proxy"' } : {}); return res.end(); }
    let u; try { u = new URL(req.url); } catch (e) { res.writeHead(400); return res.end('bad request'); }
    if (u.protocol !== 'http:') { res.writeHead(400); return res.end('bad request'); }
    const port = Number(u.port || 80);
    if (DENY_PORTS.has(port)) { res.writeHead(403); return res.end(); }
    const headers = { ...req.headers }; delete headers['proxy-authorization']; delete headers['proxy-connection'];
    if (verbose) log(`HTTP ${req.method} ${u.hostname}:${port}`);
    const up = http.request({ hostname: u.hostname, port, path: u.pathname + u.search, method: req.method, headers, lookup: safeLookup }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', (e) => { if (!res.headersSent) res.writeHead(e.code === 'EBLOCKED' ? 403 : 502); res.end(); });
    req.pipe(up);
});
server.on('connect', (req, client, head) => {              // https:// and anything else (tunnel)
    const g = gate(req); if (g) return refuse(client, g);
    const m = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(req.url || '');
    if (!m) return refuse(client, [400, 'bad request']);
    const host = m[1].replace(/^\[|\]$/g, ''), port = Number(m[2]);
    if (DENY_PORTS.has(port)) return refuse(client, [403, 'port not allowed']);
    if (verbose) log(`CONNECT ${host}:${port}`);
    const up = net.connect({ host, port, lookup: safeLookup });
    const kill = () => { client.destroy(); up.destroy(); };
    up.setTimeout(IDLE_MS, kill); client.setTimeout(IDLE_MS, kill);
    let connected = false;
    up.once('connect', () => { connected = true; client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head && head.length) up.write(head); up.pipe(client); client.pipe(up); });
    up.on('error', (e) => {
        if (!connected && client.writable) refuse(client, e.code === 'EBLOCKED' ? [403, 'blocked destination'] : [502, 'bad gateway']);
        else kill();
    });
    client.on('error', kill); up.on('close', () => client.destroy()); client.on('close', () => up.destroy());
});
server.on('clientError', (e, s) => { if (s.writable) s.end('HTTP/1.1 400 Bad Request\r\n\r\n'); });
server.listen(PORT, '0.0.0.0', () => log(`forward proxy listening on :${PORT} (allow ${env.FORWARD_ALLOW || 'private networks'}${auth ? ', auth on' : ''}${allowPrivateDest ? ', private destinations ALLOWED' : ''})`));
