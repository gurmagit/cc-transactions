# cc-transactions

A personal credit card transaction dashboard. The server scrapes Isracard and Max accounts via [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers), persists everything to a local SQLite database, and the Angular client displays, filters, sorts, and exports the results.

## Structure

- `server/` — Express API that runs the scraper, upserts transactions into SQLite, and serves them
- `client/` — Angular app (Material UI) for viewing, filtering, sorting, and exporting the data

## Prerequisites

- Node `22.23.3` (see `server/.nvmrc`) — the scraper library requires Node ≥22.22.2, and the server uses Node's built-in (experimental) `node:sqlite` module
- Angular CLI (`npm install -g @angular/cli`) for the client

## Setup

### Server

```
cd server
npm install
```

Create `server/.env` (git-ignored, never commit this file) with:

| Variable | Purpose |
|---|---|
| `PASSWORD1` | Login password used for first account |
| `PASSWORD2` | Login password used for second account |
| `ACCOUNTS_JSON` | JSON array of accounts to scrape, e.g. `[{"companyId":"isracard","id":"...","card6Digits":"..."},{"companyId":"max","username":"..."}]` |

Run with `node server.js` (listens on port 3010). On first run it creates `server/data/history.db` (git-ignored).

### Client

```
cd client
npm install
ng serve
```

Navigate to `http://localhost:4200`.

## API

- `GET /cards?days=&months=` — runs a live scrape (regular Isracard/Max accounts via the library, then the Amex card sequentially — see below), upserts results into SQLite, returns `{ data, errors }`
- `GET /cards/transactions` — reads all stored transactions straight from SQLite, no live scrape (used for normal page loads; `/cards` is only hit by the Submit button)

## Amex-branded card

Amex's own site blocks automated access, but the Amex-branded card is reachable through the shared Isracard backend using a plain (non-stealth) Puppeteer login with real credentials. This is handled separately from the regular library-based scrape:

- `server/services/isracardBackfill.js` — logs into one specific Isracard account and pulls that one Amex-branded card's transactions via the shared `GetTransactionsList` API. The account id and card suffix are hardcoded (see the constants at the top of the file) rather than read from `ACCOUNTS_JSON`.
- Runs automatically as part of `GET /cards`, after the regular scrape, sequentially (not concurrently — logging into the same Isracard account twice at once gets flagged as automation).
- `server/backfill-amex.js` — standalone full-year backfill script: `node backfill-amex.js`.
- `server/backfill-max.js` — standalone backfill script scoped to just the Max account (e.g. to backfill history without re-touching Isracard): `node backfill-max.js`.

## Duplicate prevention

`server/services/db.js` upserts on `(num, identifier)`, but different sources can report the same real transaction under different identifiers or slightly different dates. Before inserting an unrecognized identifier, it also checks for a fuzzy duplicate — same card, amount, normalized description, and normalized memo, within 2 days — and skips it if found. A small exclusion list (`FUZZY_DEDUP_EXCLUDED_DESCS`) protects legitimate recurring charges that can land within 2 days of themselves from being wrongly skipped.

