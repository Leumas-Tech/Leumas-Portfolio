// helpers/saveMessage.js
const fs = require('fs');
const path = require('path');

const MSG_PATH = path.join(__dirname, '..', 'data', 'messages.json');

module.exports = async function saveMessage(msg) {
  return new Promise((resolve, reject) => {
    fs.readFile(MSG_PATH, 'utf-8', (err, buf) => {
      const arr = !err && buf ? JSON.parse(buf) : [];
      arr.push(msg);
      fs.writeFile(MSG_PATH, JSON.stringify(arr, null, 2), (e) =>
        e ? reject(e) : resolve()
      );
    });
  });
};
