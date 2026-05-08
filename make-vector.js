const potrace = require('potrace');
const fs = require('fs');

// Make sure this filename matches your logo file exactly
const inputFile = './BookBuddy_Logo_Raw.png'; 
const outputFile = './logo.svg';

console.log("Tracing logo... please wait.");

potrace.trace(inputFile, {
    threshold: 128, // Adjust if the logo is too "thin" or "thick"
    turdSize: 10,   // Ignores small noise/speckles
    optTolerance: 0.2
}, function(err, svg) {
    if (err) {
        console.error("Error tracing image:", err);
        return;
    }
    fs.writeFileSync(outputFile, svg);
    console.log(`✨ Success! Created: ${outputFile}`);
});