const { createScraper } = require('israeli-bank-scrapers')
const { cardService } = require('./cardService')
const db = require('./db')

const sleep = ms => new Promise(r => setTimeout(r, ms))

// the scraper library parses each transaction's raw date as *local* midnight,
// then serializes it with .toISOString() (UTC) — in a timezone ahead of UTC
// (e.g. Israel) that shifts the date portion back into the previous day.
// Re-reading it through local getters undoes that shift and recovers the
// calendar date the library actually meant, instead of naively slicing the
// UTC string's first 10 characters.
function toLocalDateStr(isoString) {
  const d = new Date(isoString)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Isracard's "קרדיט" installment product reports the SAME purchase twice:
// one origination row (this pattern) carrying the full amount, dated on the
// purchase date, plus separate "קרדיט - תשלום N מתוך M" rows in later months
// each carrying its own per-installment amount. The abbreviated "תש'"/"תש
// של" here (not the literal word "תשלום") is exactly why the scraper
// library's own installment detection misses it and treats it as a normal,
// one-off, full-amount transaction. Counting both would double the total —
// the origination row is kept (for reference/originalAmount) but zeroed out.
const INSTALLMENT_ORIGINATION_MEMO = /^קרדיט ב-\d/
function isInstallmentOriginationRow(memo) {
  return INSTALLMENT_ORIGINATION_MEMO.test((memo || '').trim())
}

class DataService {
  async fetchData(days, months = 1, companyFilter = null) {
    const startDate = new Date(Date.now() - days * 86400000)
    const result = { data: [], errors: [] }
    const data = this.buildOptions(startDate, months, companyFilter)
    const results = new Array(data.length)

    // Isracard and Amex sharing the same login id log into the same backend
    // session — those must run one at a time. Different ids (even both
    // Isracard, e.g. two separate people) and Max are independent logins and
    // safe to run in parallel with everything else, so group by id/username
    // and only serialize within a group.
    const groups = new Map()
    data.forEach((obj, i) => {
      const key = obj.credentials.id || obj.credentials.username || obj.label
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(i)
    })

    const runGroup = async indices => {
      for (const i of indices) {
        const obj = data[i]
        try {
          const accounts = await this.withRetry(async () => {
            const scraper = createScraper(obj.option)
            obj.credentials.password = ['000000', '000000'].includes(obj.credentials.card6Digits)
              ? process.env.PASSWORD2
              : process.env.PASSWORD1
            const scrapeResult = await scraper.scrape(obj.credentials)
            if (!scrapeResult.success) {
              const err = new Error(
                scrapeResult.errorMessage ||
                scrapeResult.errorType ||
                'SCRAPE_FAILED'
              )
              err.type = scrapeResult.errorType
              throw err
            }
            return scrapeResult.accounts || []
          }, { retries: 2 })
          results[i] = { status: 'fulfilled', value: accounts }
        } catch (reason) {
          results[i] = { status: 'rejected', reason }
        }
      }
    }

    // launching several Chromium instances at once is only safe if the
    // machine has the CPU/RAM for it — confirmed directly on a Raspberry Pi:
    // all 3 groups launching simultaneously made even Chrome's own startup
    // time out (WS endpoint never printed in time), not a site-side block.
    // Unset (dev machines) = fully parallel, same as before; a Pi can cap
    // this via MAX_PARALLEL_SCRAPERS in .env without any code changes.
    const groupArr = [...groups.values()]
    const maxParallel = parseInt(process.env.MAX_PARALLEL_SCRAPERS) || groupArr.length
    let nextGroup = 0
    const worker = async () => {
      while (nextGroup < groupArr.length) {
        const indices = groupArr[nextGroup++]
        await runGroup(indices)
      }
    }
    await Promise.all(Array.from({ length: Math.min(maxParallel, groupArr.length) }, worker))

    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        // this library's raw chargedAmount is negative-for-purchase for both
        // Isracard and Max — confirmed directly against known real transactions
        const sign = -1
        r.value.forEach(account => {
          const num = account.accountNumber
          db.insertBalanceSnapshot({
            num,
            balance: account.balance,
            cardFrame: account.cardFrame,
            balanceDate: account.balanceDate,
          })
          if (!account.txns || account.txns.length === 0) {
            console.log('no transactions:', num)
            return
          }
          console.log(`card number: ${num}, transactions: ${account.txns.length}`)
          account.txns.forEach(txn => {
            const amount = isInstallmentOriginationRow(txn.memo) ? 0 : sign * txn.chargedAmount
            const orig = sign * txn.originalAmount
            result.data.push({
              num,
              identifier: txn.identifier,
              date: toLocalDateStr(txn.date),
              amount,
              originalAmount: orig,
              originalCurrency: txn.originalCurrency,
              desc: txn.description,
              memo: txn.memo,
            })
          })
        })
      } else {
        console.error(`Scraper failed for ${data[i].label}:`, r.reason.type, '-', this.shorten(r.reason.message))
        result.errors.push({
          company: data[i].label,
          type: r.reason.type,
          message: this.shorten(r.reason.message || 'Unknown error'),
        })
      }
    })
    db.upsertTransactions(result.data)
    console.log('len:', result.data.length, 'errors:', result.errors.length)
    return result
  }

  // some scraper failures surface the raw HTML of a bot-check/error page as the
  // "message" (e.g. Cloudflare's block page) — show something readable instead
  shorten(message, max = 150) {
    if (typeof message !== 'string') return 'Unknown error'
    const titleMatch = message.match(/<title[^>]*>([^<]*)<\/title>/i)
    if (titleMatch) {
      return titleMatch[1].trim()
    }
    const singleLine = message.replace(/\s+/g, ' ').trim()
    return singleLine.length > max ? singleLine.slice(0, max) + '…' : singleLine
  }

  buildOptions(startDate, months, companyFilter = null) {
    const arr = []
    const accounts = JSON.parse(process.env.ACCOUNTS_JSON)
    accounts.forEach((account, n) => {
      if (companyFilter && account.companyId !== companyFilter) return
      const obj = cardService.getObject(n)
      const option = { ...obj[0] }
      const credentials = obj[1]
      option.startDate = new Date(startDate)
      option.futureMonthsToScrape = months
      const label = account.card6Digits
        ? `${account.companyId} (…${String(account.card6Digits).slice(-4)})`
        : account.companyId
      arr.push({ option, credentials, label })
    })
    return arr
  }

  async withRetry(fn, {
    retries = 3,
    delay = 1000,
    rateLimitDelay = 60000,
    onFail,
  } = {}) {
    let lastError
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err
        onFail?.(err, i)
        if (i < retries) {
          // a 429/403/"automation detected" response means the server wants
          // us to back off much longer, not retry at the normal quick pace
          const isRateLimited = /429|403|automation detected/i.test(err.message || '')
          await sleep(isRateLimited ? rateLimitDelay : delay)
        }
      }
    }
    throw lastError
  }
}

module.exports = { dataService: new DataService() }
