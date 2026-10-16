const { createScraper } = require('israeli-bank-scrapers')
const { cardService } = require('./cardService')
const db = require('./db')

const sleep = ms => new Promise(r => setTimeout(r, ms))

class DataService {
  async fetchData(days, months = 1, companyFilter = null) {
    const startDate = new Date(Date.now() - days * 86400000)
    const result = { data: [], errors: [] }
    const data = this.buildOptions(startDate, months, companyFilter)
    // sequential, not Promise.allSettled — confirmed directly: scraping both
    // Isracard logins (different accounts, same provider) concurrently got
    // the second one blocked with a 429 "Automation detected", while running
    // alone it succeeds. Isracard's bot-detection evidently looks at
    // concurrent traffic to the site as a whole, not just per-account.
    const results = []
    for (const obj of data) {
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
        results.push({ status: 'fulfilled', value: accounts })
      } catch (reason) {
        results.push({ status: 'rejected', reason })
      }
    }

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
            const amount = sign * txn.chargedAmount
            const orig = sign * txn.originalAmount
            result.data.push({
              num,
              identifier: txn.identifier,
              date: txn.date.slice(0, 10),
              amount,
              originalAmount: orig,
              originalCurrency: txn.originalCurrency,
              desc: txn.description,
              memo: txn.memo,
            })
          })
        })
      } else {
        console.error(`Scraper failed for ${data[i].label}`, {
          type: r.reason.type,
          message: r.reason.message,
          stack: r.reason.stack,
        })
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
