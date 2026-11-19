'use strict';
// Builds public/sites.json (the quick-link buttons) from the QUICK_LINKS env var at container start.
// Format: Name=url pairs separated by commas or new lines. A bare domain gets https://.
// Unset -> defaults below. Set to an empty string -> no buttons.
const fs = require('fs');
const path = require('path');

const DEFAULTS = 'Google=https://www.google.com/, DuckDuckGo=https://duckduckgo.com/, YouTube=https://www.youtube.com/, Facebook=https://www.facebook.com/';
const raw = process.env.QUICK_LINKS !== undefined ? process.env.QUICK_LINKS : DEFAULTS;

const sites = [];
for (const item of raw.split(/[\n,]+/)) {
    const entry = item.trim();
    if (!entry) continue;
    const i = entry.indexOf('=');
    const name = (i > 0 ? entry.slice(0, i) : '').trim();
    let url = (i > 0 ? entry.slice(i + 1) : '').trim();
    if (!name || !url) { console.warn(`[WebProxy] QUICK_LINKS: ignoring "${entry}" (expected Name=url)`); continue; }
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = 'https://' + url;
    try { url = new URL(url).href; } catch (e) { console.warn(`[WebProxy] QUICK_LINKS: ignoring "${entry}" (invalid URL)`); continue; }
    sites.push({ name, url });
}

fs.writeFileSync(path.join(__dirname, 'public', 'sites.json'), JSON.stringify(sites));
console.log('[WebProxy] quick links: ' + (sites.map((s) => s.name).join(', ') || '(none)'));
