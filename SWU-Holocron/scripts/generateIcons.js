#!/usr/bin/env node
/**
 * Simple SVG-based icon generator for PWA
 * Creates placeholder icons with "SWU" text
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const sizes = [
  { size: 192, name: 'pwa-192x192.png' },
  { size: 512, name: 'pwa-512x512.png' },
  { size: 180, name: 'apple-touch-icon.png' }
];

const bgColor = '#1f2937'; // theme-color
const textColor = '#fbbf24'; // yellow-400

function generateSVG(size) {
  const fontSize = Math.floor(size * 0.35);
  return `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="${bgColor}" rx="${size * 0.1}"/>
  <text 
    x="50%" 
    y="50%" 
    font-family="Arial, sans-serif" 
    font-size="${fontSize}" 
    font-weight="bold" 
    fill="${textColor}" 
    text-anchor="middle" 
    dominant-baseline="central"
  >SWU</text>
</svg>`.trim();
}

// Create public directory if it doesn't exist
try {
  mkdirSync('public', { recursive: true });
} catch (e) {
  // Directory exists
}

// Generate SVG files (can be used directly or converted to PNG)
sizes.forEach(({ size, name }) => {
  const svg = generateSVG(size);
  const svgName = name.replace('.png', '.svg');
  writeFileSync(join('public', svgName), svg);
  console.log(`✓ Generated ${svgName}`);
});

console.log(`
✅ SVG icons generated in public/

To convert to PNG (requires imagemagick or online converter):
  - Use https://cloudconvert.com/svg-to-png
  - Or install imagemagick and run:
    magick convert public/pwa-192x192.svg public/pwa-192x192.png

For now, SVG icons will work in most browsers.
For production, convert to PNG for better compatibility.
`);
