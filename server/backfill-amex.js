// Standalone script — not part of the app. Run manually for a full backfill:
//   node backfill-amex.js
// (Submit also runs this automatically now, headless, for just the recent
// period — this script is for pulling the full year at once.)
const { backfillAmexCard } = require('./services/isracardBackfill')

backfillAmexCard({ monthsBack: 12, headless: false })
  .then(result => console.log('result:', result))
  .catch(err => console.error('Script crashed:', err))
