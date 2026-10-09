const { createScraper } = require('israeli-bank-scrapers');
const { cardService } = require('./cardService');

const d = new Date();
day_of_month = parseInt(d.toLocaleDateString('en-CA').slice(8,10));
month = d.getMonth();
class DataService {
  async fetchData(days, months = 1) {
    if (day_of_month > 15) {
      days = day_of_month + 15;
    } else {
      days = 45 - day_of_month;
    }
    console.log('days:', days, 'months:', months);
    let result = {data: [], error: ''};
    const startDate = new Date(Date.now() - days * 86400000);
    const data = this.buildOptions(startDate, months);
    console.log('startDate:', startDate);
    try {
      const results = await Promise.allSettled(data.map(async (obj) => {
        const scraper = createScraper(obj.option);
        obj.credentials.password = process.env.PASSWORD;
        if (['000000', '000000'].includes(obj.credentials.card6Digits)) {
          obj.credentials.password = process.env.AMEX_PWD
        }
        // console.log('creds:', obj.credentials);
        const scrapeResult = await scraper.scrape(obj.credentials);
        if (scrapeResult.success) {
          const accounts = scrapeResult.accounts;
          if (accounts) {
            accounts.forEach((account) => {
              const num = account.accountNumber;
              if (account.txns.length > 0) {
                console.log('card number:', num);
                account.txns.forEach((txn) => {
                  const amount = txn.chargedAmount * (-1);
                  const orig = txn.originalAmount * (-1);
                  if (txn.type == 'normal' && txn.memo != '' && !txn.category
                    && (amount * orig == 0 || amount == orig)) {
                    // console.log(num, txn.description.split("").reverse().join(""),
                    //   txn.originalAmount, txn.date.slice(0, 10),
                    //   txn.memo.split("").reverse().join(""));
                  } else {
                    const output = {
                      num, date: txn.date.slice(0, 10), amount, originalAmount: orig,
                      desc: txn.description, memo: txn.memo
                    };
                    const json = JSON.stringify(output).replace('\\', '');
                    // console.log(txn.identifier, ':', json);
                    result.data.push(output);
                  }
                })
              } else {
                console.log('no transactions:', num);
              }
            })
          }
        }
        else {
          throw new Error(scrapeResult.errorType);
        }
      }));
      results.forEach((r, i) => {
        // console.log('results:', r.status, i)
        if (r.status === 'rejected') {
          console.error(`Scraper failed for data[${i}]:`, r.reason);
        }
      });
    }
    catch (e) {
      console.log(e);
    }
    console.log('len:', result.data.length);
    return result.data;
  }

  buildOptions(startDate, months) {
    const arr = []
    const cards_num = JSON.parse(process.env.ACCOUNTS_JSON).length
    const indexes = [...Array(cards_num).keys()];
    indexes.forEach(n => {
      const obj = cardService.getObject(n);
      const option = { ...obj[0] };
      const credentials = obj[1];
      option.startDate = new Date(startDate);
      option.futureMonthsToScrape = months;
      arr.push({ option, credentials });
    })
    // console.table(arr, ["credentials"]);
    return arr;
  }
}

module.exports = { dataService: new DataService }