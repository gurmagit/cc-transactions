// Standalone script — not part of the app. Run manually when you want to pull
// older history for your regular accounts (Isracard x2, Max):
//   node backfill-history.js [days]
// Defaults to 365 days back. Writes straight to the db (same path data.js uses).
const { dataService } = require('./services/data')

const days = parseInt(process.argv[2]) || 365

async function main() {
  console.log(`backfilling last ${days} days...`)
  const result = await dataService.fetchData(days, 0)
  console.log(`done: ${result.data.length} transaction(s) fetched, ${result.errors.length} error(s)`)
  if (result.errors.length) {
    console.log(result.errors)
  }
}

main().catch(err => console.error('Script crashed:', err))
