# PWA Icon Generation Guide

## Quick Setup with Placeholder Icons

I've created a script to generate basic placeholder icons. Run this to get started:

## Option 1: Generate Placeholders (Quick)

Create a simple script to generate placeholder icons:

```powershell
# Create public directory if it doesn't exist
New-Item -ItemType Directory -Force -Path "public"

# You can use any image editor or online tool to create:
# - pwa-192x192.png (192x192 pixels)
# - pwa-512x512.png (512x512 pixels)
# - apple-touch-icon.png (180x180 pixels)

# For now, use favicon.io or similar online tool:
# 1. Go to https://favicon.io/favicon-generator/
# 2. Create icon with text "SWU" or your logo
# 3. Download and extract to public/ folder
# 4. Rename files to match PWA requirements
```

## Option 2: Use Existing Logo/Image

If you have a logo image:

```powershell
# Install sharp for image processing
npm install -D sharp

# Create icons-generator.js
```

```javascript
// icons-generator.js
import sharp from 'sharp';
import { promises as fs } from 'fs';

const sizes = [192, 512, 180];
const inputImage = 'logo.png'; // Your source image

async function generateIcons() {
  for (const size of sizes) {
    const filename = size === 180 
      ? 'apple-touch-icon.png' 
      : `pwa-${size}x${size}.png`;
    
    await sharp(inputImage)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 31, g: 41, b: 55, alpha: 1 } // theme-color
      })
      .toFile(`public/${filename}`);
    
    console.log(`✓ Generated ${filename}`);
  }
}

generateIcons().catch(console.error);
```

Then run: `node icons-generator.js`

## Option 3: Design Custom Icons

### Requirements:
- **192x192** - Small icon (Android home screen)
- **512x512** - Large icon (splash screen)
- **180x180** - Apple touch icon (iOS home screen)

### Design Tips:
1. **Simple & Bold** - Icons appear small, keep design clear
2. **Safe Zone** - Keep important content in center 80%
3. **Background** - Use theme color (#1f2937) or transparent
4. **Contrast** - Ensure icon stands out on various backgrounds

### Recommended Tools:
- **Figma** - Free, browser-based design tool
- **GIMP** - Free desktop image editor
- **Canva** - Easy icon templates
- **favicon.io** - Quick text-based icons

## Current Icon Placeholders

For development, the app will work with missing icons (shows default). But for production:

1. Create icons using one of the methods above
2. Place in `public/` directory:
   ```
   public/
   ├── pwa-192x192.png
   ├── pwa-512x512.png
   ├── apple-touch-icon.png
   └── favicon.ico (optional)
   ```

3. Icons will be automatically included in PWA build

## Testing Icons

After adding icons:

```powershell
npm run dev
```

Check in browser:
- Open DevTools → Application → Manifest
- Verify icons show up correctly
- Test "Add to Home Screen" on mobile
