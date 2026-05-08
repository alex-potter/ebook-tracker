const vtracer = require('vtracer');
const fs = require('fs');

const inputPath = "./BookBuddy_Logo_Raw.png";
const outputPath = "./logo.svg";

// Read the image and convert to SVG
const image = fs.readFileSync(inputPath);
const svg = vtracer.convert(image, {
    mode: 'logo',
    colormode: 'color',
    hierarchical: 'cut'
});

fs.writeFileSync(outputPath, svg);
console.log("Successfully created logo.svg!");