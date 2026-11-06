const { CompanyTypes } = require('israeli-bank-scrapers');
require('dotenv').config();

class CardService {
  constructor() {
    this.obj = [
      {
        combineInstallments: false,
        showBrowser: false,
        // explicit, not left to puppeteer's own env-var resolution — needed
        // on ARM (e.g. a Raspberry Pi), where puppeteer's bundled Chrome
        // download is x86_64-only and won't run; unset on anything else
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
      },
      {}
    ]
  }
  getObject(n) {
    const companyId = JSON.parse(process.env.ACCOUNTS_JSON)[n].companyId;
    // console.log(n, companyId);
    switch (companyId) {
      case 'isracard':
        this.obj[0].companyId = CompanyTypes.isracard;
        this.obj[0].defaultTimeout = undefined;
        this.obj[1] = {
          id: JSON.parse(process.env.ACCOUNTS_JSON)[n].id,
          card6Digits: JSON.parse(process.env.ACCOUNTS_JSON)[n].card6Digits
        }
        break;
      case 'amex':
        this.obj[0].companyId = CompanyTypes.amex;
        // Cloudflare's browser challenge on he.americanexpress.co.il can take
        // longer than puppeteer's 30s default navigation timeout to resolve
        this.obj[0].defaultTimeout = 90000;
        this.obj[1] = {
          id: JSON.parse(process.env.ACCOUNTS_JSON)[n].id,
          card6Digits: JSON.parse(process.env.ACCOUNTS_JSON)[n].card6Digits
        }
        break;
      case 'max':
        this.obj[0].companyId = CompanyTypes.max;
        this.obj[0].defaultTimeout = undefined;
        this.obj[1] = {
          username: JSON.parse(process.env.ACCOUNTS_JSON)[n].username
        }
        break;
    }
    return this.obj;
  }
}

module.exports = { cardService: new CardService }