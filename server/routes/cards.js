const express = require('express');
const router = express.Router();
const { dataService } = require('../services/data');
const { backfillAmexCard } = require('../services/isracardBackfill');
const db = require('../services/db');

router.get('/', async (req, res) => {
  console.log('Submit pressed — scraping...');
  const query = req.query;
  const days = parseInt(query.days) || 30;
  const months = parseInt(query.months) || 0;
  // card 3802 can't be reached through the library (Amex's own site blocks
  // it) — fetch it the same way backfill-amex.js does, after the regular
  // scrape finishes, just for the recent period instead of a full year.
  // Run sequentially, not in parallel: both log into the same 025647512
  // account on digital.isracard.co.il, and doing that concurrently looks
  // like two simultaneous logins to the same account — which is exactly
  // the kind of thing that gets flagged as automation.
  const result = await dataService.fetchData(days, months);
  const amexResult = await backfillAmexCard({ monthsBack: 2, headless: true });
  if (!amexResult.success) {
    result.errors.push({ company: 'amex (…3802)', type: 'GENERIC', message: amexResult.error });
  }
  res.send(result);
});

router.get('/transactions', (req, res) => {
  res.send(db.getAllTransactions());
});

module.exports = router;