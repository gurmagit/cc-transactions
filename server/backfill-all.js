// Standalone script — not part of the app. Runs all three backfills in one go:
//   node backfill-all.js [days]
// Defaults to 365 days back (applies to Isracard/Max; Amex always pulls a
// full year, matching backfill-amex.js's own default).
//
// Isracard and Amex both log into the same digital.isracard.co.il backend,
// so they must never run concurrently — simultaneous logins there get
// flagged as automation (see the comment in data.js). Max is independent,
// but there's no time pressure for a one-off backfill, so everything here
// just runs sequentially for simplicity.
const { dataService } = require('./services/data')
const { backfillAmexCard } = require('./services/isracardBackfill')

const days = parseInt(process.argv[2]) || 365

async function main() {
  console.log(`backfilling last ${days} days (max)...`)
  const maxResult = await dataService.fetchData(days, 0, 'max')
  console.log(`max done: ${maxResult.data.length} transaction(s), ${maxResult.errors.length} error(s)`)
  if (maxResult.errors.length) console.log(maxResult.errors)

  console.log(`backfilling last ${days} days (isracard)...`)
  const isracardResult = await dataService.fetchData(days, 0, 'isracard')
  console.log(`isracard done: ${isracardResult.data.length} transaction(s), ${isracardResult.errors.length} error(s)`)
  if (isracardResult.errors.length) console.log(isracardResult.errors)

  console.log('backfilling amex (3802)...')
  const amexResult = await backfillAmexCard({ monthsBack: 12, headless: false })
  console.log('amex result:', amexResult)
}

main().catch(err => console.error('Script crashed:', err))
