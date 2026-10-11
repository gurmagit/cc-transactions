// Standalone script — not yet wired into the app. Run manually:
//   node fetch-amex-via-isracard.js
// Logs into Isracard (plain puppeteer, no stealth — not blocked), then calls
// the shared GetTransactionsList API for card 3802 across several past
// billing months, writing all results into the DB.
require('dotenv').config()
const puppeteer = require('puppeteer')
const db = require('./services/db')

const sleep = ms => new Promise(r => setTimeout(r, ms))
const CARD_NUM = '3802'
const COMPANY_CODE = 77
const MONTHS_BACK = 12

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

async function main() {
  const accounts = JSON.parse(process.env.ACCOUNTS_JSON)
  const isracard = accounts.find(a => a.companyId === 'isracard' && a.id === '025647512')
  if (!isracard) {
    console.error('No matching isracard entry found in ACCOUNTS_JSON')
    return
  }

  const browser = await puppeteer.launch({ headless: false })
  const page = (await browser.pages())[0]

  console.log('logging in to isracard...')
  await page.goto('https://digital.isracard.co.il/personalarea/Login', { waitUntil: 'networkidle2' })
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

  await humanType(page, '#otpLoginId_ID', isracard.id)
  await sleep(300 + Math.random() * 400)
  await humanType(page, '#cardnum', isracard.card6Digits)
  await sleep(300 + Math.random() * 400)
  await humanType(page, '#otpLoginPwd', process.env.PASSWORD2)
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
  console.log('login done, current url:', page.url())

  console.log(`loading transactions page for card ${CARD_NUM} (to establish session there)...`)
  await page.goto(`https://web.isracard.co.il/transactions?cardSuffix=${CARD_NUM}`, { waitUntil: 'networkidle2' })
  await sleep(1000)

  const allVouchers = []
  for (const month of billingMonthsBack(MONTHS_BACK)) {
    console.log(`fetching billingMonth=${month.str} (isNextBillingDate=${month.isCurrent})...`)
    const json = await page.evaluate(async (payload) => {
      const res = await fetch('https://web.isracard.co.il/ocp/transactions/DigitalV3.Transactions/GetTransactionsList', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      return res.json()
    }, {
      card4Number: CARD_NUM,
      isNextBillingDate: month.isCurrent,
      cardStatus: 0,
      billingMonth: month.str,
      companyCode: COMPANY_CODE,
      isPartner: false,
    })

    const vouchers = json?.data?.israelAbroadVouchers?.vouchers?.israelAbroadVouchersList || []
    console.log(`  -> ${vouchers.length} transaction(s)`)
    allVouchers.push(...vouchers)
    await sleep(500 + Math.random() * 500)
  }

  if (!allVouchers.length) {
    console.log('No transactions found across any month.')
    await browser.close()
    return
  }

  const txns = allVouchers.map(v => ({
    num: CARD_NUM,
    identifier: v.voucherNumber != null ? String(v.voucherNumber) : undefined,
    date: toIsoDate(v.purchaseDate),
    amount: -v.billingAmount,
    originalAmount: -v.originalAmount,
    desc: v.businessName || v.transactionDescription || '',
    memo: (v.moreInfo || '').trim(),
  }))

  db.upsertTransactions(txns)
  console.log(`wrote ${txns.length} transaction(s) total for card ${CARD_NUM} to the db`)

  await browser.close()
}

main().catch(err => console.error('Script crashed:', err))
