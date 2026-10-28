# PricePilot AI — development source

This is an unfinished development sandbox, not a production-ready release.

## Run
Requires Node.js 22 or later and npm.

```sh
npm ci
npm run dev
```

Open the local app on port 3000 and register a new account. Local PostgreSQL data and a development session secret are created under .data/. No account credentials are included.

## Checks
```sh
npm run typecheck
npm test
npm run build
```
With the development server running: `npm run smoke`.
Browser checks: `npm run test:browser` (the current Playwright configuration expects Chromium at /usr/bin/chromium).
Do not run a build concurrently with the development server.

## Implemented
Persian RTL dashboard, authentication, tenant-scoped data, local PostgreSQL persistence, sandbox subscriptions, wallet credits, catalog, manual Torob match confirmation, manual sandbox competitor inputs, decimal-based pricing simulation, sandbox approvals and rollback, CSV export, audit history.

## Limitations
No live payment, OTP, Barchin retrieval, store connection/import/publishing, distributed worker, Telegram bot, or super-admin implementation is delivered. Automatic live publishing is disabled. Production PostgreSQL mode has not been integration-tested. This source needs further implementation, security review and operational validation before production.

## Previous validation
13 pricing cases, 26 HTTP workflow assertions, and one Chromium merchant journey passed in the original development environment. An earlier production build passed; the final source needs a fresh build after restoration.

Dependencies, generated builds, local database, secrets, Git metadata, and test-account data are excluded from this archive.
