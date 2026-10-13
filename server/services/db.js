const path = require('path')
const fs = require('fs')
const { DatabaseSync } = require('node:sqlite')

const dataDir = path.join(__dirname, '..', 'data')
fs.mkdirSync(dataDir, { recursive: true })
const db = new DatabaseSync(path.join(dataDir, 'history.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    num TEXT NOT NULL,
    identifier TEXT NOT NULL,
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    originalAmount REAL NOT NULL,
    desc TEXT,
    memo TEXT,
    scraped_at TEXT NOT NULL,
    PRIMARY KEY (num, identifier)
  );
  CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);

  CREATE TABLE IF NOT EXISTS balance_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    num TEXT NOT NULL,
    balance REAL,
    cardFrame REAL,
    balanceDate TEXT,
    scraped_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_balance_num ON balance_snapshots(num);
`)

const upsertStmt = db.prepare(`
  INSERT OR REPLACE INTO transactions
    (num, identifier, date, amount, originalAmount, desc, memo, scraped_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)

const insertBalanceStmt = db.prepare(`
  INSERT INTO balance_snapshots (num, balance, cardFrame, balanceDate, scraped_at)
  VALUES (?, ?, ?, ?, ?)
`)

const selectAllStmt = db.prepare(
  'SELECT num, date, amount, originalAmount, desc, memo FROM transactions ORDER BY date DESC'
)
const existsStmt = db.prepare('SELECT 1 FROM transactions WHERE num = ? AND identifier = ?')
const sameAmountStmt = db.prepare('SELECT identifier, date, desc, memo FROM transactions WHERE num = ? AND amount = ?')

// Max transactions without dealData (standing orders, refunds, etc.) come back
// with identifier === undefined; node:sqlite throws on an undefined bind rather
// than storing NULL, so fall back to a per-content key (not a shared placeholder,
// to avoid colliding unrelated rows under the composite PK).
function fallbackIdentifier(txn) {
  return `noid:${txn.date}:${txn.desc}:${txn.amount}:${txn.originalAmount}`
}

// different sources (library vs the direct-API scraper) can assign the same
// real transaction different identifiers, and even render the same Hebrew
// text with different punctuation encoding — so an exact-identifier miss
// isn't proof it's a new transaction. Normalize and compare on content too.
function normalizeText(s) {
  return (s || '')
    .normalize('NFC')
    .replace(/['"׳״“”]/g, '')
    // installment counters like "תשלום 1 מתוך 3" vs "תשלום 1 מ 3" are the same
    // text from different sources, just abbreviated differently. \b doesn't
    // work here (Hebrew letters aren't \w), so match on whitespace directly.
    .replace(/(^|\s)מתוך(\s|$)/g, '$1מ$2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// recurring charges whose desc/amount/memo are always identical and which
// can legitimately recur within 2 days of each other (e.g. a monthly charge
// landing right at a cycle boundary) — never treat these as duplicates
const FUZZY_DEDUP_EXCLUDED_DESCS = ['ליברה עסקאות ביטוח'].map(normalizeText)

function findFuzzyDuplicate(txn) {
  const txnDesc = normalizeText(txn.desc)
  if (FUZZY_DEDUP_EXCLUDED_DESCS.includes(txnDesc)) return null
  const candidates = sameAmountStmt.all(txn.num, txn.amount)
  const txnMemo = normalizeText(txn.memo)
  for (const c of candidates) {
    if (normalizeText(c.desc) !== txnDesc) continue
    if (normalizeText(c.memo) !== txnMemo) continue
    const dayDiff = Math.abs(new Date(c.date) - new Date(txn.date)) / 86400000
    if (dayDiff <= 2) return c
  }
  return null
}

function upsertTransactions(txns) {
  const now = new Date().toISOString()
  let skipped = 0
  for (const txn of txns) {
    const identifier = txn.identifier != null ? String(txn.identifier) : fallbackIdentifier(txn)
    if (txn.identifier == null) {
      console.warn('transaction missing identifier, using fallback key', {
        num: txn.num,
        date: txn.date,
        desc: txn.desc,
      })
    }

    // only worth checking for a fuzzy duplicate if this isn't already a known
    // row — an exact (num, identifier) match is just a normal update
    if (!existsStmt.get(txn.num, identifier)) {
      const dup = findFuzzyDuplicate(txn)
      if (dup) {
        skipped++
        continue
      }
    }

    upsertStmt.run(
      txn.num,
      identifier,
      txn.date,
      txn.amount,
      txn.originalAmount,
      txn.desc ?? null,
      txn.memo ?? null,
      now
    )
  }
  if (skipped) {
    console.log(`skipped ${skipped} duplicate transaction(s)`)
  }
}

function insertBalanceSnapshot({ num, balance, cardFrame, balanceDate }) {
  insertBalanceStmt.run(
    num,
    balance ?? null,
    cardFrame ?? null,
    balanceDate ?? null,
    new Date().toISOString()
  )
}

function getAllTransactions() {
  return selectAllStmt.all()
}

module.exports = { upsertTransactions, insertBalanceSnapshot, getAllTransactions }
