// Test runner — `node tests/run.js`
const fs = require('fs');
const path = require('path');
const { summary } = require('./_harness');

const here = __dirname;
const files = fs.readdirSync(here)
    .filter(f => f.endsWith('.test.js'))
    .sort();

if (files.length === 0) {
    console.error('No *.test.js files found in', here);
    process.exit(1);
}

console.log(`Running ${files.length} test file(s):\n`);
for (const f of files) {
    console.log(`\x1b[1m${f}\x1b[0m`);
    require(path.join(here, f));
}
summary();
