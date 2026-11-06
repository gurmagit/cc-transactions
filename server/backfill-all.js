// Standalone script — not part of the app. Runs all three backfills in one go:
//   node backfill-all.js [days]
// Defaults to 365 days back.
const { dataService } = require('./services/data')

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
  const amexResult = await dataService.fetchData(days, 0, 'amex')
  console.log(`amex done: ${amexResult.data.length} transaction(s), ${amexResult.errors.length} error(s)`)
  if (amexResult.errors.length) console.log(amexResult.errors)
}

main().catch(err => console.error('Script crashed:', err))
