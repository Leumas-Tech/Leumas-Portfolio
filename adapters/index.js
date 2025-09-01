// adapters/index.js
const fs = require('fs');
const path = require('path');

function loadAdapters() {
  const files = fs
    .readdirSync(__dirname)
    .filter(f => f !== 'index.js' && f.endsWith('.js'));
  return files.map(f => {
    const mod = require(path.join(__dirname, f));
    const id = mod.id || path.basename(f, '.js');
    return { id, ...mod };
  });
}

function mount(router) {
  const adapters = loadAdapters();
  adapters.forEach(a => {
    if (a.get) {
      router.get(`/${a.id}`, async (req, res) => {
        try {
          const out = await a.get(req, res);
          res.json(out);
        } catch (e) {
          console.error(`[${a.id}]`, e);
          res.status(500).json({ error: e.message });
        }
      });
    }
    if (a.post) {
      router.post(`/${a.id}`, async (req, res) => {
        try {
          const out = await a.post(req, res);
          res.json(out);
        } catch (e) {
          console.error(`[${a.id}]`, e);
          res.status(500).json({ error: e.message });
        }
      });
    }
  });
}

module.exports = {
  mount,
  loadAdapters,
  list: () => loadAdapters().map(a => a.id),
};
