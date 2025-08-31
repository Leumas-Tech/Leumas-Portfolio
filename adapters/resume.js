// adapters/resume.js
const resume = require('../data/resume.json');
const profile = require('../data/profile.json');

module.exports = {
  id: 'resume',
  async get() {
    return { profile, resume };
  }
};
