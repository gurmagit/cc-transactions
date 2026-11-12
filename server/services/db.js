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

// category/originalCurrency/category_source were added after the table
// already had rows — CREATE TABLE IF NOT EXISTS won't retrofit a column onto
// an existing table, so migrate by hand
for (const col of ['category', 'originalCurrency', 'category_source']) {
  const has = db.prepare("SELECT 1 FROM pragma_table_info('transactions') WHERE name = ?").get(col)
  if (!has) {
    db.exec(`ALTER TABLE transactions ADD COLUMN ${col} TEXT`)
  }
}

// a real upsert, not INSERT OR REPLACE — category is deliberately left out of
// the DO UPDATE SET so a re-scrape of an existing transaction never clobbers
// an LLM-assigned or manually-set category. originalCurrency, like the other
// scraped fields, is fine to overwrite on every re-scrape.
const upsertStmt = db.prepare(`
  INSERT INTO transactions
    (num, identifier, date, amount, originalAmount, desc, memo, scraped_at, category, originalCurrency)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(num, identifier) DO UPDATE SET
    date=excluded.date, amount=excluded.amount, originalAmount=excluded.originalAmount,
    desc=excluded.desc, memo=excluded.memo, scraped_at=excluded.scraped_at,
    originalCurrency=excluded.originalCurrency
`)

const insertBalanceStmt = db.prepare(`
  INSERT INTO balance_snapshots (num, balance, cardFrame, balanceDate, scraped_at)
  VALUES (?, ?, ?, ?, ?)
`)

const selectAllStmt = db.prepare(
  'SELECT num, identifier, date, amount, originalAmount, desc, memo, category, originalCurrency FROM transactions ORDER BY date DESC'
)
const selectUncategorizedStmt = db.prepare(
  'SELECT num, identifier, desc, memo, amount FROM transactions WHERE category IS NULL'
)
const setCategoryStmt = db.prepare(
  'UPDATE transactions SET category = ?, category_source = ? WHERE num = ? AND identifier = ?'
)
const selectDescsStmt = db.prepare('SELECT num, identifier, desc, amount FROM transactions')
// one example per distinct merchant (by normalized desc), most recent first —
// avoids flooding the prompt with 50 near-identical grocery-store rows. The
// correlated subquery (not a bare GROUP BY) is what makes "most recent"
// deterministic — SQLite doesn't guarantee which row's other columns a bare
// GROUP BY picks.
const selectManualExamplesStmt = db.prepare(`
  SELECT desc, memo, amount, category FROM transactions t
  WHERE category_source = 'manual'
    AND scraped_at = (
      SELECT MAX(scraped_at) FROM transactions t2
      WHERE LOWER(TRIM(t2.desc)) = LOWER(TRIM(t.desc)) AND t2.category_source = 'manual'
    )
  GROUP BY LOWER(TRIM(desc))
  ORDER BY scraped_at DESC
  LIMIT ?
`)
const existsStmt = db.prepare('SELECT 1 FROM transactions WHERE num = ? AND identifier = ?')
// matched on originalAmount, not amount — a pending transaction can be
// stored with amount 0 (confirmed later, e.g. once a fallback-identifier
// row's real identifier arrives) or have its ILS conversion adjusted, while
// originalAmount (what was actually charged, in its original currency) is
// set from the start and stays stable. desc+memo+date-proximity (checked
// below) is still required either way.
const sameOriginalAmountStmt = db.prepare(
  'SELECT identifier, date, desc, memo FROM transactions WHERE num = ? AND originalAmount = ?'
)

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
  const candidates = sameOriginalAmountStmt.all(txn.num, txn.originalAmount)
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
  let refreshed = 0
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
    let targetIdentifier = identifier
    if (!existsStmt.get(txn.num, identifier)) {
      const dup = findFuzzyDuplicate(txn)
      if (dup) {
        // same real transaction, but this source assigned it a different
        // identifier than what's stored (seen with foreign-currency
        // transactions, where the library can flip between its inbound and
        // outbound voucher-number fields across scrapes) — refresh the
        // existing row under its original identifier instead of silently
        // discarding data (which meant a field added after a row's first
        // capture, like originalCurrency, could never backfill onto it)
        targetIdentifier = dup.identifier
        refreshed++
      }
    }

    upsertStmt.run(
      txn.num,
      targetIdentifier,
      txn.date,
      txn.amount,
      txn.originalAmount,
      txn.desc ?? null,
      txn.memo ?? null,
      now,
      txn.category ?? null,
      txn.originalCurrency ?? null
    )
  }
  if (refreshed) {
    console.log(`refreshed ${refreshed} transaction(s) matched by content (identifier differed from stored)`)
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

function getUncategorized() {
  return selectUncategorizedStmt.all()
}

// manual = the user picked it in the UI — the ground truth used as few-shot
// examples for future LLM categorization. llm = the model guessed it.
function setCategory(num, identifier, category, source = 'manual') {
  setCategoryStmt.run(category, source, num, identifier)
}

function setCategories(updates, source = 'llm') {
  for (const { num, identifier, category } of updates) {
    setCategoryStmt.run(category, source, num, identifier)
  }
}

// bulk category update — always matches by description (normalized, since a
// recurring merchant can appear under slightly different desc text depending
// on which source scraped it: trailing whitespace, quote-character variants
// — the same cases normalizeText already handles for dedup), optionally
// narrowed further by amount and/or card number, per the confirm dialog's checkboxes
function setCategoryByCriteria({ desc, amount, num, category }) {
  const targetDesc = normalizeText(desc)
  const rows = selectDescsStmt.all()
  let count = 0
  for (const r of rows) {
    if (normalizeText(r.desc) !== targetDesc) continue
    if (amount != null && r.amount !== amount) continue
    if (num != null && r.num !== num) continue
    setCategoryStmt.run(category, 'manual', r.num, r.identifier)
    count++
  }
  return count
}

function getManualCategoryExamples(limit = 40) {
  return selectManualExamplesStmt.all(limit)
}

// last scrape's outcome (scheduled cron run or manual Submit) — lets the
// dashboard flag a failure that happened with no one watching, e.g. cron
const scrapeStatusFile = path.join(dataDir, 'scrape-status.json')

function getScrapeStatus() {
  try {
    return JSON.parse(fs.readFileSync(scrapeStatusFile, 'utf8'))
  } catch {
    return null
  }
}

function setScrapeStatus(status) {
  fs.writeFileSync(scrapeStatusFile, JSON.stringify(status))
}

function recordScrapeResult(errors) {
  setScrapeStatus(errors.length
    ? { timestamp: new Date().toISOString(), success: false, error: errors.map(e => `${e.company}: ${e.message}`).join('; ') }
    : { timestamp: new Date().toISOString(), success: true })
}

module.exports = {
  upsertTransactions, insertBalanceSnapshot, getAllTransactions,
  getUncategorized, setCategory, setCategories, setCategoryByCriteria,
  getManualCategoryExamples, getScrapeStatus, setScrapeStatus, recordScrapeResult,
}
