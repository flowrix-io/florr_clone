const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '../assets');
const outputFile = path.join(__dirname, '../src/imageAssets.ts');

const assets = {};
const files = fs.readdirSync(assetsDir).filter(file => file.endsWith('.png'));

files.forEach(file => {
    const filePath = path.join(assetsDir, file);
    const data = fs.readFileSync(filePath);
    const base64 = data.toString('base64');
    const key = file.replace('.png', '');
    assets[key] = `data:image/png;base64,${base64}`;
});

const output = `// Auto-generated file - do not edit
export const IMAGE_ASSETS = ${JSON.stringify(assets, null, 2)};
`;

fs.writeFileSync(outputFile, output);
console.log('Generated imageAssets.ts with', Object.keys(assets).length, 'images'); 