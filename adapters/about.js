// adapters/about.js
const profile = require('../data/profile.json');
const about = require('../data/about.json');

module.exports = {
  id: 'about',
  async get() {
    return {
      profile,        // name, role, avatar, contacts (for aside)
      about           // paragraphs + "what I'm doing" cards
    };
  }
};
