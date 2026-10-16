// Standalone script — not part of the app. Run manually after ANTHROPIC_API_KEY
// is added to .env, to categorize all existing transactions (new ones get
// categorized automatically as part of Submit, via routes/cards.js):
//   node backfill-categories.js
const db = require('./services/db')
const { categorizeInChunks } = require('./services/categorize')

async function main() {
  const toCategorize = db.getUncategorized()
  console.log(`${toCategorize.length} transaction(s) to categorize`)
  if (!toCategorize.length) return

  const examples = db.getManualCategoryExamples()
  console.log(`using ${examples.length} manually-set example(s) as guidance`)

  // categorizeInChunks already chunks internally (40 at a time, tuned for
  // reliable LLM output) and progresses through the whole list
  const categories = await categorizeInChunks(toCategorize, examples)
  db.setCategories(toCategorize.map((t, i) => ({ num: t.num, identifier: t.identifier, category: categories[i] })))

  const done = categories.filter(c => c !== null).length
  console.log(`done: ${done}/${toCategorize.length} categorized`)
}

main().catch(err => console.error('Script crashed:', err))
