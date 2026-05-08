const fs = require('fs');

try {
    const svgData = fs.readFileSync('./logo.svg', 'utf8');

    // 1. Find the 'd' attributes (works for <path d="..." or <PATH D="...">)
    const paths = svgData.match(/d\s*=\s*["']([^"']+)["']/gi);

    if (!paths) {
        throw new Error("Could not find any path data. Is logo.svg empty?");
    }

    // 2. Clean up the extracted paths and colors
    const pathTags = paths.map(p => {
        const d = p.match(/["']([^"']+)["']/)[1];
        return `<path d="${d}" fill="black" />`;
    }).join('\n');

    // 3. Create a "Zoomed" SVG
    // We wrap all paths in a group <g> and scale it up (1.5x) to kill the padding
    // Then we center it using translate.
    const normalizedSVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white" />
    <g transform="translate(512, 512) scale(1.6) translate(-512, -512)">
        ${pathTags}
    </g>
</svg>`;

    fs.writeFileSync('./logo_production.svg', normalizedSVG);
    console.log("✅ Success! Created logo_production.svg.");
    console.log("Check it in your browser—it should be much larger now.");
} catch (e) {
    console.error("❌ Error:", e.message);
}