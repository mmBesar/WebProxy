'use strict';
const tls = ['1', 'true', 'yes', 'on'].includes(String(process.env.TLS_ENABLED || '').toLowerCase());
const lib = require(tls ? 'https' : 'http');
lib.get({ host: '127.0.0.1', port: 8080, path: '/', rejectUnauthorized: false }, (r) => process.exit(r.statusCode === 200 ? 0 : 1))
    .on('error', () => process.exit(1));
