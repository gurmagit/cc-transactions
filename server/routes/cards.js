const express = require('express');
const router = express.Router();
const { dataService } = require('../services/data');

router.get('/', async (req, res) => {
  const query = req.query;
  console.log('query:', query);
  const days = parseInt(query.days) || 30;
  const months = parseInt(query.months) || 0;
  const result = await dataService.fetchData(days, months);
  res.send(result);
});

module.exports = router;