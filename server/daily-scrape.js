// Standalone script — not part of the app. Does exactly what pressing
// "Submit" in the UI does: scrapes the last 30 days (+1 future month) and
// categorizes any new transactions. Meant to be run on a schedule (cron),
// not manually — see routes/cards.js for the on-demand equivalent.
const { dataService } = require('./services/data')
const { categorizeInChunks } = require('./services/categorize')
const db = require('./services/db')

// cron's output redirect doesn't timestamp anything — do it here so the log
// shows when each run happened, not just that it happened
const origLog = console.log
const origError = console.error
console.log = (...args) => origLog(new Date().toISOString(), ...args)
console.error = (...args) => origError(new Date().toISOString(), ...args)

async function main() {
  const result = await dataService.fetchData(30, 2)
  console.log(`scraped: ${result.data.length} transaction(s), ${result.errors.length} error(s)`)
  if (result.errors.length) console.log(result.errors)
  db.recordScrapeResult(result.errors)

  const toCategorize = db.getUncategorized()
  if (toCategorize.length) {
    const examples = db.getManualCategoryExamples()
    const categories = await categorizeInChunks(toCategorize, examples)
    db.setCategories(toCategorize.map((t, i) => ({ num: t.num, identifier: t.identifier, category: categories[i] })))
    console.log(`categorized ${categories.filter(c => c !== null).length}/${toCategorize.length}`)
  }
}

main().catch(err => {
  console.error('daily-scrape crashed:', err)
  db.setScrapeStatus({ timestamp: new Date().toISOString(), success: false, error: err.message })
})
