const zlib = require('zlib');
const fs = require('fs');

const inp = fs.createReadStream('dist/bundle.js');
const out = fs.createWriteStream('dist/bundle.bin');
const deflateRaw = zlib.createDeflateRaw();

inp.pipe(deflateRaw).pipe(out);

async function getFileSize(path) {
  try {
    const fileStats = fs.statSync(path);
    console.log(`${path} size: ${fileStats.size} bytes`);
    return fileStats.size;
  } catch (err) {
    console.error("Error reading file stats:", err);
  }
}

getFileSize('dist/bundle.js');
getFileSize('dist/bundle.bin');