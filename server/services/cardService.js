const { CompanyTypes } = require('israeli-bank-scrapers');
require('dotenv').config();

class CardService {
  constructor() {
    this.obj = [
      {
        combineInstallments: false,
        showBrowser: false
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
        this.obj[1] = {
          id: JSON.parse(process.env.ACCOUNTS_JSON)[n].id,
          card6Digits: JSON.parse(process.env.ACCOUNTS_JSON)[n].card6Digits
        }
        break;
      case 'max':
        this.obj[0].companyId = CompanyTypes.max;
        this.obj[1] = {
          username: JSON.parse(process.env.ACCOUNTS_JSON)[n].username
        }
        break;
    }
    return this.obj;
  }
}

module.exports = { cardService: new CardService }