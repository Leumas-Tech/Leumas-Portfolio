// adapters/admin.js
const fs = require('fs/promises');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

async function get(req, res) {
  if (req.params.file) {
    const filePath = path.join(dataDir, req.params.file);
    const content = await fs.readFile(filePath, 'utf-8');
    res.send(content);
  } else {
    const files = await fs.readdir(dataDir);
    res.json(files.filter(f => f.endsWith('.json')));
  }
}

async function post(req, res) {
  const filePath = path.join(dataDir, req.params.file);
  const { content } = req.body;
  await fs.writeFile(filePath, content, 'utf-8');
  res.json({ ok: true });
}

module.exports = {
  id: 'admin',
  get,
  post,
};
