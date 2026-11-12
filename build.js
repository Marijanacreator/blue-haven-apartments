const fs = require('node:fs');
const path = require('node:path');
const output = path.join(__dirname, 'public');
fs.mkdirSync(output, { recursive: true });
for (const name of ['index.html', 'form.js', 'images']) fs.cpSync(path.join(__dirname, name), path.join(output, name), { recursive: true });
console.log('Public assets built; server code and environment files excluded.');
