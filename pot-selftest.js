'use strict';
// Runs once at container start: proves the whole token chain works from THIS server (network, BotGuard).
const base = (process.env.POT_URL || '').replace(/\/+$/, '');
const log = (m) => console.log(`[${new Date().toISOString()}] [POT] ${m}`);
(async () => {
    if (!base) return;
    for (let i = 0; i < 45; i++) {
        try { const r = await fetch(base + '/ping', { signal: AbortSignal.timeout(3000) }); if (r.ok) break; } catch (e) { /* not up yet */ }
        if (i === 44) return log('self-test: provider ' + base + ' is not reachable (is the pot-provider service running?)');
        await new Promise((r) => setTimeout(r, 2000));
    }
    try {
        const t0 = Date.now();
        const r = await fetch(base + '/get_pot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(90000) });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.poToken) log(`self-test OK: provider minted a PO token (${j.poToken.length} chars, ${Date.now() - t0} ms)`);
        else log(`self-test FAILED: provider answered ${r.status} ${(j.error || '').toString().slice(0, 300)}`);
    } catch (e) { log('self-test FAILED: ' + e.message); }
})();
