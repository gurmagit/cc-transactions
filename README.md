# cc-transactions

A personal credit card transaction dashboard. The server scrapes Isracard and Max accounts via [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers), and the Angular client displays, filters, and exports the results.

## Structure

- `server/` — Express API that runs the scraper (`POST /cards`) and returns transactions + per-account errors
- `client/` — Angular app (Material UI) for viewing, filtering, sorting, and exporting the data

## Prerequisites

- Node `22.23.3` (see `server/.nvmrc`) — the scraper library requires Node ≥22.22.2
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

Run with `node server.js` (listens on port 3010).

### Client

```
cd client
npm install
ng serve
```

Navigate to `http://localhost:4200`.

## Notes

- `server/index.html` and `server/script.js` are a legacy pre-Angular prototype, kept for reference but not used by the current app.
- `server/services/data1.js` is an unused earlier draft of `data.js`.
