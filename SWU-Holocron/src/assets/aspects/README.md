# Aspect Icon Assets

This directory is for official Star Wars Unlimited aspect icons that match the in-game design.

## Required Files

Please provide SVG files for each aspect:

1. `aggression.svg` - Red aspect icon
2. `vigilance.svg` - Blue aspect icon
3. `command.svg` - Green aspect icon
4. `cunning.svg` - Yellow/Gold aspect icon
5. `heroism.svg` - Light/White aspect icon
6. `villainy.svg` - Dark/Black aspect icon
7. `neutral.svg` - Gray aspect icon

## Specifications

- **Format:** SVG (Scalable Vector Graphics)
- **ViewBox:** Recommended 24x24 or maintain aspect ratio
- **Style:** Match official SWU card design
- **Colors:** Icons should be monochrome (single color) as colors are applied via CSS classes
  - If icons contain intrinsic colors, provide them matching the official game palette

## Color Palette

Once you provide the icons, we'll need the exact hex color codes for each aspect to update in `src/constants.js`:

- **Aggression:** #?????? (currently using Tailwind `text-red-500`)
- **Vigilance:** #?????? (currently using Tailwind `text-blue-500`)
- **Command:** #?????? (currently using Tailwind `text-green-500`)
- **Cunning:** #?????? (currently using Tailwind `text-yellow-500`)
- **Heroism:** #?????? (currently using Tailwind `text-white`)
- **Villainy:** #?????? (currently using Tailwind `text-zinc-950`)
- **Neutral:** #?????? (currently using Tailwind `text-gray-500`)

## Integration

Once assets are provided:

1. Place SVG files in this directory
2. Install vite-plugin-svgr: `npm install -D vite-plugin-svgr`
3. Update `vite.config.js` to enable SVG imports
4. Create `src/components/AspectIcons.jsx` to map icons
5. Update `src/constants.js` ASPECTS array to use custom icons and colors

See implementation notes in the codebase for detailed integration steps.
