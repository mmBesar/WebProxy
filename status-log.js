'use strict';
// Debug aid (enable with LOG_STATUS=true). For matching requests, logs what the proxy
// answered to the browser: status, method, request body length, content-type, whether the
// response finished or was cut off, bytes written and duration.
// Optional: LOG_BODY_MAX=<bytes> also logs the response body (base64) when it is at most
// that size, so tiny error/control responses can be decoded offline.
// Query strings are not logged (they contain signed tokens). Session ids are shortened.
const http = require('http');

const match = new RegExp(process.env.LOG_STATUS_MATCH || 'googlevideo|youtubei|/api/stats', 'i');
const bodyMax = Number(process.env.LOG_BODY_MAX || 0);
const proto = http.ServerResponse.prototype;
const origWriteHead = proto.writeHead;

proto.writeHead = function (...args) {
    try {
        const req = this.req;
        if (req && !this.__statusLogged) {
            this.__statusLogged = true;
            const url = req.url || '';
            const code = typeof args[0] === 'number' ? args[0] : this.statusCode;
            if (match.test(url) || code >= 400) {
                const hdrs = args.find((a) => a && typeof a === 'object' && !Array.isArray(a)) || {};
                const hdr = (n) => hdrs[n] || hdrs[n.replace(/(^|-)(\w)/g, (m, a, b) => a + b.toUpperCase())] || this.getHeader(n);
                const ct = hdr('content-type') || '-';
                const ce = hdr('content-encoding') || '-';
                const [path, qs = ''] = url.split('?');
                const rn = (qs.match(/(?:^|&)rn=(\d+)/) || [])[1];
                const short = path.replace(/^\/[0-9a-f]{32}/i, '/<sid>').slice(0, 170);
                const t0 = Date.now();
                const reqLen = req.headers['content-length'] || '-';
                const label = `${code} ${req.method} ${short}${rn ? ' rn=' + rn : ''} reqlen=${reqLen} type=${ct} enc=${ce}`;

                let bytes = 0;
                const kept = [];
                let keptLen = 0;
                const take = (c, enc) => {
                    if (c == null || typeof c === 'function') return;
                    const b = Buffer.isBuffer(c) ? c : typeof c === 'string' ? Buffer.from(c, typeof enc === 'string' ? enc : 'utf8') : Buffer.from(c);
                    bytes += b.length;
                    if (bodyMax > 0 && keptLen <= bodyMax) { kept.push(b); keptLen += b.length; }
                };
                const w = this.write, e = this.end;
                this.write = function (c, enc, ...r) { take(c, enc); return w.call(this, c, enc, ...r); };
                this.end = function (c, enc, ...r) { take(c, enc); return e.call(this, c, enc, ...r); };

                this.once('close', () => {
                    const state = this.writableFinished ? 'finished' : 'CUT-OFF';
                    const ts = new Date().toISOString();
                    console.log(`[${ts}] [STATUS] ${label} ${state} bytes=${bytes} ms=${Date.now() - t0}`);
                    if (bodyMax > 0 && bytes > 0 && bytes <= bodyMax) {
                        console.log(`[${ts}] [BODY] rn=${rn || '-'} bytes=${bytes} enc=${ce} base64=${Buffer.concat(kept).toString('base64')}`);
                    }
                });
            }
        }
    } catch (err) { /* never break the proxy for logging */ }
    return origWriteHead.apply(this, args);
};
console.log('[WebProxy] status logging enabled, matching: ' + match + (bodyMax ? `, bodies up to ${bodyMax} bytes` : ''));
