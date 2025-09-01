// adapters/portfolio.js
const portfolio = require('../data/portfolio.json');
const profile = require('../data/profile.json');

module.exports = {
  id: 'portfolio',
  async get(req) {
    const cat = (req.query.cat || 'All').toLowerCase();
    const items = cat === 'all'
      ? portfolio.items
      : portfolio.items.filter(i => i.category.toLowerCase() === cat);
    return { profile, categories: portfolio.categories, items };
  }
};
