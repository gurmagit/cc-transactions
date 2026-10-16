// Fetches the Amex-branded card (3802) through the shared Isracard backend,
// since Amex's own site blocks automated access but this route doesn't.
// Regular Isracard cards are handled by the library/Submit as normal — this
// is only needed for the one card the library can't reach.
require('dotenv').config()
const db = require('./db')
const puppeteer = require('puppeteer')
// const puppeteer = require('puppeteer-extra');
// const StealthPlugin = require('puppeteer-extra-plugin-stealth');
// puppeteer.use(StealthPlugin());

const sleep = ms => new Promise(r => setTimeout(r, ms))
const AMEX_CARD_SUFFIX = '3802'
const AMEX_COMPANY_CODE = 77

async function humanType(page, selector, text) {
  for (const char of text) {
    await page.type(selector, char, { delay: 60 + Math.random() * 180 })
  }
}

function toIsoDate(ddmmyyyy) {
  const [d, m, y] = ddmmyyyy.split('/')
  return `${y}-${m}-${d}`
}

function billingMonthsBack(n) {
  const months = []
  const now = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    months.push({ str: `01/${mm}/${d.getFullYear()}`, isCurrent: i === 0 })
  }
  return months
}

async function loginToIsracard(page, account) {
  console.log(`logging in to isracard (id ${account.id})...`)
  const response = await page.goto('https://digital.isracard.co.il/personalarea/Login', { waitUntil: 'networkidle2' })
  if (response && response.status() >= 400) {
    throw new Error(`Failed to navigate to login page, status code: ${response.status()}`)
  }
  await sleep(1500)

  const flip = await page.$('#flip')
  if (flip) {
    await flip.click()
    await sleep(1000)
  }
  const idRadio = await page.$('#radioID2')
  if (idRadio) {
    await idRadio.click()
    await sleep(300)
  }

  const password = account.card6Digits === '000000' ? process.env.PASSWORD2 : process.env.PASSWORD1

  if (!(await page.$('#otpLoginId_ID'))) {
    const title = await page.title().catch(() => 'unknown')
    throw new Error(`Login form not found after navigating (page title: "${title}", url: ${page.url()}) — likely blocked`)
  }

  await humanType(page, '#otpLoginId_ID', account.id)
  await sleep(300 + Math.random() * 400)
  await humanType(page, '#cardnum', account.card6Digits)
  await sleep(300 + Math.random() * 400)
  await humanType(page, '#otpLoginPwd', password)
  await sleep(500 + Math.random() * 500)

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null),
    page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim() === 'כניסה לחשבון שלי')
      if (!btn) throw new Error('login submit button not found')
      btn.click()
    }),
  ])
  await sleep(2000)
}

// monthsBack: how many calendar months of statements to pull (default 2,
// enough to cover the current billing cycle plus a safety margin — matches
// what a routine Submit's ~30-day window would cover, not a full backfill)
async function backfillAmexCard({ monthsBack = 2, headless = false } = {}) {
  const account = JSON.parse(process.env.ACCOUNTS_JSON)
    .find(a => a.companyId === 'isracard' && a.id === '025647512')
  if (!account) {
    return { success: false, error: 'No matching isracard entry found in ACCOUNTS_JSON for id 025647512' }
  }

  // Isracard's login endpoint 403s on Puppeteer's headless:true. Instead,
  // always launch a real headed window (nothing about the page differs from
  // a normal browser) and just position it off-screen when "headless" was
  // requested, so it never actually shows up.
  const browser = await puppeteer.launch(
    headless ? { headless: false, args: ['--window-position=-32000,-32000'] } : {}
  )
  try {
    const page = (await browser.pages())[0]

    await loginToIsracard(page, account)

    await page.goto(`https://web.isracard.co.il/transactions?cardSuffix=${AMEX_CARD_SUFFIX}`, { waitUntil: 'networkidle2' })
    await sleep(1000)

    const allVouchers = []
    for (const month of billingMonthsBack(monthsBack)) {
      const json = await page.evaluate(async (payload) => {
        const res = await fetch('https://web.isracard.co.il/ocp/transactions/DigitalV3.Transactions/GetTransactionsList', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        return res.json()
      }, {
        card4Number: AMEX_CARD_SUFFIX,
        isNextBillingDate: month.isCurrent,
        cardStatus: 0,
        billingMonth: month.str,
        companyCode: AMEX_COMPANY_CODE,
        isPartner: false,
      })

      const vouchers = json?.data?.israelAbroadVouchers?.vouchers?.israelAbroadVouchersList || []
      allVouchers.push(...vouchers)
      await sleep(500 + Math.random() * 500)
    }

    if (!allVouchers.length) {
      return { success: true, count: 0 }
    }

    // raw billingAmount is already positive-for-purchase / negative-for-refund
    const txns = allVouchers.map(v => ({
      num: AMEX_CARD_SUFFIX,
      identifier: v.voucherNumber != null ? String(v.voucherNumber) : undefined,
      date: toIsoDate(v.purchaseDate),
      amount: v.billingAmount,
      originalAmount: v.originalAmount,
      // for some voucher types (e.g. card-fee line items) this raw field
      // isn't a real currency code — seen literally "0.0" for plain
      // domestic ILS charges. Only trust it if it looks like one.
      originalCurrency: /^[A-Z]{3}$/.test(v.originalCurrency) ? v.originalCurrency : 'ILS',
      desc: v.businessName || v.transactionDescription || '',
      memo: (v.moreInfo || '').trim(),
    }))
    db.upsertTransactions(txns)
    console.log(`amex: wrote ${txns.length} transaction(s) for card ${AMEX_CARD_SUFFIX}`)
    return { success: true, count: txns.length }
  } catch (err) {
    console.error('amex backfill failed:', err)
    return { success: false, error: err.message || String(err) }
  } finally {
    await browser.close()
  }
}

module.exports = { backfillAmexCard }
