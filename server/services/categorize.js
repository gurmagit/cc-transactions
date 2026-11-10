require('dotenv').config()
const Anthropic = require('@anthropic-ai/sdk')

const MODEL = 'claude-haiku-4-5-20251001'

// single source of truth for the category list — the Angular client keeps
// its own mirrored copy for the dropdown, since client/server don't share a
// package. Expect this to grow over time.
const CATEGORIES = [
  'ביגוד', 'בילויים', 'סופר', 'בריאות ושיניים', 'ביטוח', 'תחבורה',
  'עירייה וממשלה', 'תקשורת', 'חשבונות בית', 'טיפוח וכושר', 'חיות מחמד', 'חצר וגינה', 'החזרים', 'חופשה', 'ילדים', 'שונות',
]

const client = new Anthropic()

function buildPrompt(txns, examples) {
  const lines = txns.map((t, i) =>
    `${i + 1}. desc="${t.desc || ''}" memo="${t.memo || ''}" amount=${t.amount}`
  ).join('\n')
  const examplesSection = examples.length
    ? `This user has manually categorized these transactions themselves — match their judgment for similar ones (merchant, purpose) over your own guess when they conflict:
${examples.map(e => `- desc="${e.desc || ''}" memo="${e.memo || ''}" amount=${e.amount} → ${e.category}`).join('\n')}

`
    : ''
  return `Classify each of these ${txns.length} Israeli credit card transactions into exactly one of these categories:
${CATEGORIES.join(', ')}

${examplesSection}Transactions:
${lines}

Respond with ONLY a JSON array of ${txns.length} category strings, in the same order, each one exactly matching one of the category names above (use "שונות" if unsure). No other text.`
}

// assumes the batch already fits comfortably in one request — callers with
// many rows should use categorizeInChunks instead. examples: the user's own
// past manual corrections, as few-shot guidance (see db.getManualCategoryExamples)
async function categorizeTransactions(txns, examples = []) {
  if (!txns.length) return []
  try {
    const response = await client.messages.create({
      model: MODEL,
      // a 150-item chunk's JSON array response was landing right at the old
      // 4096 cap and getting truncated mid-array — comfortable headroom now
      max_tokens: 8192,
      messages: [{ role: 'user', content: buildPrompt(txns, examples) }],
    })
    const text = response.content[0]?.text || ''
    const match = text.match(/\[[\s\S]*\]/)
    const categories = JSON.parse(match ? match[0] : text)
    if (!Array.isArray(categories) || categories.length !== txns.length) {
      throw new Error(`expected ${txns.length} categories, got ${Array.isArray(categories) ? categories.length : typeof categories}`)
    }
    return categories.map(c => CATEGORIES.includes(c) ? c : 'שונות')
  } catch (err) {
    // a failed categorization just leaves these rows uncategorized to retry
    // next time — never breaks the caller's flow over this. The caller logs
    // one summary line for the whole Submit instead of one per chunk here.
    return txns.map(() => null)
  }
}

// 150 was too many for Haiku to keep a reliable 1:1 count on — confirmed via
// direct test: a 150-item chunk came back with 129 categories despite
// finishing normally (not truncated), so the whole chunk got discarded
async function categorizeInChunks(txns, examples = [], chunkSize = 40) {
  const results = []
  for (let i = 0; i < txns.length; i += chunkSize) {
    const chunk = txns.slice(i, i + chunkSize)
    const categories = await categorizeTransactions(chunk, examples)
    results.push(...categories)
  }
  return results
}

module.exports = { CATEGORIES, categorizeTransactions, categorizeInChunks }
