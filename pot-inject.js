'use strict';
// YouTube PO-token injection (fixes "stream stops after ~30-45 s / on seek").
// YouTube's streaming server answers the proxied page with STREAM_PROTECTION_STATUS 1 -> 2 -> 3 (rejected)
// because the page cannot attest itself through the proxy. Real clients fix that by sending a PO token
// (streamer_context.po_token). This hook mints one through the bgutil POT provider (POT_URL) and swaps it
// into the page's own stream requests. Everything else is left untouched; on any failure the request
// is passed through unchanged.
const env = process.env;
const POT_URL = (env.POT_URL || '').replace(/\/+$/, '');
if (POT_URL) {
    const hostRe = new RegExp(env.POT_HOST_REGEX || '(^|\\.)googlevideo\\.com$', 'i');
    const ytRe = new RegExp(env.POT_VISITOR_HOST_REGEX || '(^|\\.)youtube\\.com$', 'i');
    const logAll = String(env.POT_LOG || '').toLowerCase() === 'all';
    const log = (m) => console.log(`[${new Date().toISOString()}] [POT] ${m}`);

    // ---- minimal protobuf wire editing (keeps every other byte of the request exactly as the browser sent it)
    const readVarint = (b, o) => { let r = 0, s = 0, x; do { x = b[o++]; r += (x & 0x7f) * 2 ** s; s += 7; } while (x & 0x80); return [r, o]; };
    const encVarint = (n) => { const a = []; while (n >= 0x80) { a.push((n % 128) | 0x80); n = Math.floor(n / 128); } a.push(n); return Buffer.from(a); };
    function fieldsOf(b) {
        const out = []; let o = 0;
        while (o < b.length) {
            const st = o; let tag; [tag, o] = readVarint(b, o);
            const wt = tag & 7, fn = Math.floor(tag / 8); let vs = o;
            if (wt === 0) { [, o] = readVarint(b, o); }
            else if (wt === 1) o += 8;
            else if (wt === 5) o += 4;
            else if (wt === 2) { let len; [len, o] = readVarint(b, o); vs = o; o += len; }
            else throw new Error('unsupported wire type ' + wt);
            if (o > b.length) throw new Error('truncated');
            out.push({ fn, wt, st, end: o, vs, ve: o });
        }
        return out;
    }
    const lenField = (fn, val) => Buffer.concat([encVarint(fn * 8 + 2), encVarint(val.length), val]);
    function setLenField(b, fn, val) {
        const f = fieldsOf(b).find((x) => x.fn === fn && x.wt === 2);
        const enc = lenField(fn, val);
        return f ? Buffer.concat([b.subarray(0, f.st), enc, b.subarray(f.end)]) : Buffer.concat([b, enc]);
    }
    // VideoPlaybackAbrRequest.streamer_context = field 19; StreamerContext.po_token = field 2
    function patchPoToken(body, token) {
        const sc = fieldsOf(body).find((f) => f.fn === 19 && f.wt === 2);
        if (!sc) return null;
        const inner = setLenField(body.subarray(sc.vs, sc.ve), 2, token);
        return Buffer.concat([body.subarray(0, sc.st), lenField(19, inner), body.subarray(sc.end)]);
    }

    // ---- token provider client (cached per visitorData)
    const cache = new Map(), inflight = new Map(), visitors = new Map(), warned = new Set();
    const b64urlToBuf = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    async function getToken(binding) {
        const c = cache.get(binding);
        if (c && c.exp > Date.now() + 5 * 60e3) return c;
        if (inflight.has(binding)) return inflight.get(binding);
        const p = (async () => {
            const t0 = Date.now();
            const r = await fetch(POT_URL + '/get_pot', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ content_binding: binding }), signal: AbortSignal.timeout(45000),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || !j.poToken) throw new Error(`provider answered ${r.status}: ${(j.error || '').toString().slice(0, 200)}`);
            const exp = Date.parse(j.expiresAt) || Date.now() + 3600e3;
            const v = { bytes: b64urlToBuf(j.poToken), exp };
            cache.set(binding, v);
            if (cache.size > 200) cache.delete(cache.keys().next().value);
            log(`minted PO token for visitor ${binding.slice(0, 8)}... (${v.bytes.length} bytes, ${Date.now() - t0} ms)`);
            return v;
        })().finally(() => inflight.delete(binding));
        inflight.set(binding, p);
        return p;
    }
    const warnOnce = (key, msg) => { if (!warned.has(key)) { warned.add(key); if (warned.size > 500) warned.clear(); log(msg); } };
    const hdrKey = (h, name) => Object.keys(h || {}).find((k) => k.toLowerCase() === name);

    async function handle(ctx) {
        const o = ctx.reqOpts; if (!o) return;
        const host = o.hostname || '', path = o.path || '', method = String(o.method || '').toUpperCase();
        const sid = ctx.session && ctx.session.id;
        if (ytRe.test(host) && path.startsWith('/youtubei/v1/')) {
            let vd; const k = hdrKey(o.headers, 'x-goog-visitor-id');
            if (k) vd = o.headers[k];
            if (!vd && Buffer.isBuffer(o.body) && o.body.length < 200000 && /json/i.test(String(o.headers[hdrKey(o.headers, 'content-type')] || ''))) {
                try { vd = JSON.parse(o.body.toString('utf8')).context.client.visitorData; } catch (e) { /* not json */ }
            }
            if (vd && sid) { visitors.set(sid, vd); if (visitors.size > 500) visitors.delete(visitors.keys().next().value); }
        } else if (method === 'POST' && hostRe.test(host) && path.startsWith('/videoplayback') && /[?&]sabr=1/.test(path) && Buffer.isBuffer(o.body) && o.body.length) {
            const vd = sid && visitors.get(sid);
            if (!vd) return warnOnce('novd:' + sid, 'no visitorData seen for this session yet; stream request sent unchanged');
            let tok;
            try { tok = await getToken(vd); } catch (e) { return warnOnce('err:' + e.message, 'could not get a PO token: ' + e.message); }
            let nb; try { nb = patchPoToken(o.body, tok.bytes); } catch (e) { nb = null; }
            if (!nb) return warnOnce('parse', 'stream request body is not the expected format; sent unchanged');
            o.body = nb;
            const lk = hdrKey(o.headers, 'content-length') || 'content-length';
            o.headers[lk] = String(nb.length);
            if (logAll || !warned.has('inj:' + sid)) { warned.add('inj:' + sid); log(`injected PO token into stream request (session ${String(sid).slice(0, 6)}...)`); }
        }
    }

    const Ctx = require('testcafe-hammerhead/lib/request-pipeline/context');
    const orig = Ctx.prototype.onRequestHookRequest;
    Ctx.prototype.onRequestHookRequest = async function (...args) {
        try { await handle(this); } catch (e) { log('hook error (ignored): ' + e.message); }
        return orig.apply(this, args);
    };
    module.exports = { patchPoToken, fieldsOf };
    if (!process.env.__POT_QUIET) log('PO-token injection active, provider: ' + POT_URL);
}
