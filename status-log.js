'use strict';
// Debug aid (enable with LOG_STATUS=true). For matching requests, logs what the proxy
// answered to the browser: status, method, content-type, whether the response finished
// or was cut off, how many bytes were written and how long it took.
// Query strings are not logged (they contain signed tokens). Session ids are shortened.
const http = require('http');

const match = new RegExp(process.env.LOG_STATUS_MATCH || 'googlevideo|youtubei|/api/stats', 'i');
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
                const ct = hdrs['content-type'] || hdrs['Content-Type'] || this.getHeader('content-type') || '-';
                const [path, qs = ''] = url.split('?');
                const rn = (qs.match(/(?:^|&)rn=(\d+)/) || [])[1];
                const short = path.replace(/^\/[0-9a-f]{32}/i, '/<sid>').slice(0, 170);
                const t0 = Date.now();
                let bytes = 0;
                const size = (c) => (c == null || typeof c === 'function' ? 0 : typeof c === 'string' ? Buffer.byteLength(c) : c.length || 0);
                const w = this.write, e = this.end;
                this.write = function (c, ...r) { bytes += size(c); return w.call(this, c, ...r); };
                this.end = function (c, ...r) { bytes += size(c); return e.call(this, c, ...r); };
                const label = `${code} ${req.method} ${short}${rn ? ' rn=' + rn : ''} type=${ct}`;
                this.once('close', () => {
                    const state = this.writableFinished ? 'finished' : 'CUT-OFF';
                    console.log(`[${new Date().toISOString()}] [STATUS] ${label} ${state} bytes=${bytes} ms=${Date.now() - t0}`);
                });
            }
        }
    } catch (e) { /* never break the proxy for logging */ }
    return origWriteHead.apply(this, args);
};
console.log('[WebProxy] status logging enabled, matching: ' + match);
