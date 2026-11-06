const express = require('express');
const router = express.Router();
const { dataService } = require('../services/data');
const { categorizeInChunks } = require('../services/categorize');
const db = require('../services/db');

router.get('/', async (req, res) => {
  console.log('Submit pressed — scraping...');
  const query = req.query;
  const days = parseInt(query.days) || 30;
  const months = parseInt(query.months) || 0;
  const result = await dataService.fetchData(days, months);

  // categorize whatever's new (or previously failed) — never fails the
  // Submit response over this, just leaves those rows uncategorized to
  // retry next time
  let categorized = 0, toCategorizeCount = 0, categorizationError = null;
  try {
    const toCategorize = db.getUncategorized();
    toCategorizeCount = toCategorize.length;
    if (toCategorize.length) {
      const examples = db.getManualCategoryExamples();
      const categories = await categorizeInChunks(toCategorize, examples);
      db.setCategories(toCategorize.map((t, i) => ({ num: t.num, identifier: t.identifier, category: categories[i] })));
      categorized = categories.filter(c => c !== null).length;
    }
  } catch (err) {
    categorizationError = err.message;
  }

  console.log(
    `Submit finished: ${result.data.length} transaction(s), ${result.errors.length} error(s), ` +
    `${categorized}/${toCategorizeCount} categorized` +
    (categorizationError ? ` (categorization error: ${categorizationError})` : '')
  );
  res.send(result);
});

router.get('/transactions', (req, res) => {
  res.send(db.getAllTransactions());
});

router.patch('/transactions/bulk-category', (req, res) => {
  const { desc, amount, num, category } = req.body;
  const updated = db.setCategoryByCriteria({ desc, amount, num, category });
  res.json({ updated });
});

router.patch('/transactions/:num/:identifier', (req, res) => {
  const { category } = req.body;
  db.setCategory(req.params.num, req.params.identifier, category);
  res.sendStatus(204);
});

module.exports = router;