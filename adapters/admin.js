// adapters/admin.js
const fs = require('fs/promises');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

function generateSchema(json) {
  const schema = {
    type: 'object',
    properties: {},
  };

  for (const key in json) {
    if (Array.isArray(json[key])) {
      schema.properties[key] = {
        type: 'array',
        items: {
          type: 'object',
          properties: {},
        },
      };
      if (json[key].length > 0) {
        const itemSchema = generateSchema(json[key][0]);
        schema.properties[key].items = itemSchema;
      }
    } else if (typeof json[key] === 'object' && json[key] !== null) {
      schema.properties[key] = generateSchema(json[key]);
    } else {
      schema.properties[key] = {
        type: typeof json[key],
      };
    }
  }

  return schema;
}

async function get(req, res) {
  if (req.params.file) {
    const filePath = path.join(dataDir, req.params.file);
    const content = await fs.readFile(filePath, 'utf-8');
    const json = JSON.parse(content);
    const schema = generateSchema(json);
    res.json(schema);
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