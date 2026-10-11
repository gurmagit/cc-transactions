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

// Max transactions without dealData (standing orders, refunds, etc.) come back
// with identifier === undefined; node:sqlite throws on an undefined bind rather
// than storing NULL, so fall back to a per-content key (not a shared placeholder,
// to avoid colliding unrelated rows under the composite PK).
function fallbackIdentifier(txn) {
  return `noid:${txn.date}:${txn.desc}:${txn.amount}:${txn.originalAmount}`
}

function upsertTransactions(txns) {
  const now = new Date().toISOString()
  for (const txn of txns) {
    const identifier = txn.identifier != null ? String(txn.identifier) : fallbackIdentifier(txn)
    if (txn.identifier == null) {
      console.warn('transaction missing identifier, using fallback key', {
        num: txn.num,
        date: txn.date,
        desc: txn.desc,
      })
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
