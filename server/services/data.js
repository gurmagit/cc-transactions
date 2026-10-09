const { createScraper } = require('israeli-bank-scrapers')
const { cardService } = require('./cardService')

const sleep = ms => new Promise(r => setTimeout(r, ms))

class DataService {
  async fetchData(days, months = 1) {
    if (days < 31) {
      const d = new Date()
      const day_of_month = d.getDate()
      if (day_of_month < 13) {
        days = day_of_month + 20
      } else {
        days = day_of_month - 12
      }
    }
    console.log('days:', days, 'months:', months)
    const startDate = new Date(Date.now() - days * 86400000)
    console.log('startDate:', startDate)
    const result = { data: [], errors: [] }
    const data = this.buildOptions(startDate, months)
    const results = await Promise.allSettled(
      data.map(obj =>
        this.withRetry(async () => {
          const scraper = createScraper(obj.option)
          obj.credentials.password = obj.credentials.card6Digits === '000000'
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
      )
    )

    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        r.value.forEach(account => {
          const num = account.accountNumber
          if (!account.txns || account.txns.length === 0) {
            console.log('no transactions:', num)
            return
          }
          console.log('card number:', num)
          account.txns.forEach(txn => {
            const amount = -txn.chargedAmount
            const orig = -txn.originalAmount
            result.data.push({
              num,
              date: txn.date.slice(0, 10),
              amount,
              originalAmount: orig,
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

  buildOptions(startDate, months) {
    const arr = []
    const accounts = JSON.parse(process.env.ACCOUNTS_JSON)
    accounts.forEach((account, n) => {
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
    onFail,
  } = {}) {
    let lastError
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err
        onFail?.(err, i)
        if (i < retries) await sleep(delay)
      }
    }
    throw lastError
  }
}

module.exports = { dataService: new DataService() }
