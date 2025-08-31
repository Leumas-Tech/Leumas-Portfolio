// adapters/contact.js
const profile = require('../data/profile.json');
const saveMessage = require('../helpers/saveMessage');

module.exports = {
  id: 'contact',
  async get() {
    // expose contact cards for the UI
    return {
      profile,
      contact: {
        email: profile.contact.email,
        phone: profile.contact.phone,
        location: profile.contact.location
      }
    };
  },
  async post(req) {
    const { name, email, message } = req.body || {};
    if (!name || !email || !message) {
      return { ok: false, error: 'name, email and message are required' };
    }
    await saveMessage({ name, email, message, ts: new Date().toISOString() });
    return { ok: true };
  }
};
