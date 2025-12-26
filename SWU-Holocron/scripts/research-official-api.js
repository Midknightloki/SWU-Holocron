/**
 * Research script to investigate starwarsunlimited.com structure
 *
 * This script attempts to:
 * 1. Find Next.js BUILD_ID
 * 2. Test various API endpoints
 * 3. Extract card data structure
 * 4. Discover CDN image URL patterns
 *
 * Run with: node scripts/research-official-api.js
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://starwarsunlimited.com';
const CDN_URL = 'https://cdn.starwarsunlimited.com';

// Test results storage
const results = {
  timestamp: new Date().toISOString(),
  buildId: null,
  workingEndpoints: [],
  cardSamples: [],
  imagePatterns: []
};

/**
 * Find Next.js BUILD_ID from HTML source
 */
async function findBuildId() {
  console.log('\n📍 Step 1: Finding Next.js BUILD_ID...');

  try {
    const response = await fetch(`${BASE_URL}/cards`);
    const html = await response.text();

    // Try multiple patterns
    const patterns = [
      /"buildId":"([^"]+)"/,
      /"buildId":"([a-zA-Z0-9_-]+)"/,
      /buildId&quot;:&quot;([^&]+)&quot;/,
      /_next\/data\/([a-zA-Z0-9_-]+)\//
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        results.buildId = match[1];
        console.log(`✅ Found BUILD_ID: ${results.buildId}`);
        return results.buildId;
      }
    }

    console.log('❌ Could not find BUILD_ID');

    // Save HTML for manual inspection
    fs.writeFileSync('starwarsunlimited-homepage.html', html);
    console.log('💾 Saved HTML to starwarsunlimited-homepage.html for manual inspection');

    return null;
  } catch (error) {
    console.error('❌ Error fetching homepage:', error.message);
    return null;
  }
}

/**
 * Test various API endpoints
 */
async function testApiEndpoints(buildId) {
  console.log('\n📍 Step 2: Testing API endpoints...');

  const endpoints = [
    // Next.js data endpoints
    `/_next/data/${buildId}/cards.json`,
    `/_next/data/${buildId}/en/cards.json`,
    `/api/cards`,
    `/api/card-database`,

    // GraphQL
    `/api/graphql`,
    `/graphql`,

    // Strapi CMS
    `/api/cards`,
    `/api/sets`,
    `/api/collections`
  ];

  for (const endpoint of endpoints) {
    try {
      console.log(`Testing: ${endpoint}`);
      const response = await fetch(`${BASE_URL}${endpoint}`);

      const contentType = response.headers.get('content-type') || '';
      console.log(`  Status: ${response.status}, Type: ${contentType}`);

      if (response.ok) {
        const text = await response.text();

        try {
          const json = JSON.parse(text);
          results.workingEndpoints.push({
            endpoint,
            status: response.status,
            contentType,
            dataType: Array.isArray(json) ? 'array' : typeof json,
            sampleKeys: Object.keys(json).slice(0, 10)
          });

          console.log(`  ✅ SUCCESS! Data type: ${Array.isArray(json) ? 'array' : typeof json}`);
          console.log(`  📝 Sample keys:`, Object.keys(json).slice(0, 10));

          // Save sample data
          fs.writeFileSync(
            `sample-${endpoint.replace(/\//g, '-')}.json`,
            JSON.stringify(json, null, 2).substring(0, 10000)
          );

        } catch (e) {
          console.log(`  ⚠️  Non-JSON response (${text.length} chars)`);
        }
      } else {
        console.log(`  ❌ Failed: ${response.status}`);
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
  }
}

/**
 * Test CDN image patterns
 */
async function testCdnPatterns() {
  console.log('\n📍 Step 3: Testing CDN image patterns...');

  // Known working image from user
  const knownImage = 'medium_G25090003_EN_Obi_Wan_Kenobi_363ae5ae2d.png';

  const testPatterns = [
    // Different sizes
    `card_G25090003_EN_Obi_Wan_Kenobi_363ae5ae2d.png`,
    `small_G25090003_EN_Obi_Wan_Kenobi_363ae5ae2d.png`,
    `large_G25090003_EN_Obi_Wan_Kenobi_363ae5ae2d.png`,
    `thumb_G25090003_EN_Obi_Wan_Kenobi_363ae5ae2d.png`,

    // Standard set cards (guessing common patterns)
    `card_01010001_EN_Luke_Skywalker_Leader_*.png`,
    `card_01000001_EN_Cell_Block_Rescue_Event_*.png`
  ];

  for (const pattern of testPatterns) {
    if (pattern.includes('*')) {
      console.log(`  📋 Pattern template: ${pattern}`);
      continue;
    }

    try {
      const url = `${CDN_URL}/${pattern}`;
      console.log(`Testing: ${pattern}`);

      const response = await fetch(url, { method: 'HEAD' });

      if (response.ok) {
        results.imagePatterns.push({
          pattern,
          status: response.status,
          contentType: response.headers.get('content-type'),
          size: response.headers.get('content-length')
        });
        console.log(`  ✅ EXISTS! Size: ${response.headers.get('content-length')} bytes`);
      } else {
        console.log(`  ❌ Not found: ${response.status}`);
      }

      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
  }
}

/**
 * Extract card data from any discovered endpoints
 */
async function extractCardData() {
  console.log('\n📍 Step 4: Extracting sample card data...');

  if (results.workingEndpoints.length === 0) {
    console.log('⚠️  No working endpoints found');
    return;
  }

  for (const endpoint of results.workingEndpoints) {
    try {
      const response = await fetch(`${BASE_URL}${endpoint.endpoint}`);
      const data = await response.json();

      // Try to find card objects
      let cards = [];

      if (Array.isArray(data)) {
        cards = data;
      } else if (data.cards && Array.isArray(data.cards)) {
        cards = data.cards;
      } else if (data.data && Array.isArray(data.data)) {
        cards = data.data;
      } else if (data.pageProps && data.pageProps.cards) {
        cards = data.pageProps.cards;
      }

      if (cards.length > 0) {
        console.log(`✅ Found ${cards.length} cards in ${endpoint.endpoint}`);
        results.cardSamples = cards.slice(0, 5);

        console.log('\n📋 Sample card structure:');
        console.log(JSON.stringify(cards[0], null, 2));

        // Analyze card properties
        const allKeys = new Set();
        cards.slice(0, 10).forEach(card => {
          Object.keys(card).forEach(key => allKeys.add(key));
        });

        console.log('\n📊 All card properties found:');
        console.log(Array.from(allKeys).sort());
      }

    } catch (error) {
      console.log(`❌ Error processing ${endpoint.endpoint}:`, error.message);
    }
  }
}

/**
 * Check robots.txt and terms of service
 */
async function checkLegalConsiderations() {
  console.log('\n📍 Step 5: Checking legal considerations...');

  try {
    const robotsResponse = await fetch(`${BASE_URL}/robots.txt`);
    if (robotsResponse.ok) {
      const robotsTxt = await robotsResponse.text();
      console.log('📄 robots.txt:');
      console.log(robotsTxt);

      // Check if /cards is disallowed
      if (robotsTxt.includes('Disallow: /cards') || robotsTxt.includes('Disallow: /api')) {
        console.log('⚠️  WARNING: robots.txt may restrict access to these endpoints');
      }
    }
  } catch (error) {
    console.log('❌ Could not fetch robots.txt');
  }
}

/**
 * Generate recommendations based on findings
 */
function generateRecommendations() {
  console.log('\n📍 Step 6: Generating recommendations...');

  const recommendations = {
    canScrape: results.workingEndpoints.length > 0,
    method: 'unknown',
    confidence: 'low'
  };

  if (results.workingEndpoints.length > 0) {
    recommendations.method = 'api-endpoints';
    recommendations.confidence = 'high';
    console.log('✅ Recommended: Use discovered API endpoints');
  } else if (results.buildId) {
    recommendations.method = 'nextjs-static';
    recommendations.confidence = 'medium';
    console.log('⚠️  Recommended: Try parsing Next.js static data');
  } else {
    recommendations.method = 'puppeteer-scraping';
    recommendations.confidence = 'low';
    console.log('❌ Recommended: Use Puppeteer/headless browser (last resort)');
  }

  return recommendations;
}

/**
 * Main execution
 */
async function main() {
  console.log('🔍 SWU Official Site Research Tool');
  console.log('====================================\n');

  // Step 1: Find build ID
  const buildId = await findBuildId();

  // Step 2: Test endpoints (with or without build ID)
  await testApiEndpoints(buildId || 'UNKNOWN');

  // Step 3: Test CDN patterns
  await testCdnPatterns();

  // Step 4: Extract card data
  await extractCardData();

  // Step 5: Legal considerations
  await checkLegalConsiderations();

  // Step 6: Recommendations
  const recommendations = generateRecommendations();
  results.recommendations = recommendations;

  // Save complete results
  const outputPath = path.join(process.cwd(), 'research-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

  console.log('\n✅ Research complete!');
  console.log(`📄 Full results saved to: ${outputPath}`);
  console.log('\n📊 Summary:');
  console.log(`  - Working endpoints: ${results.workingEndpoints.length}`);
  console.log(`  - Card samples found: ${results.cardSamples.length}`);
  console.log(`  - Image patterns tested: ${results.imagePatterns.length}`);
  console.log(`  - Recommendation: ${recommendations.method} (${recommendations.confidence} confidence)`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { findBuildId, testApiEndpoints, testCdnPatterns, extractCardData };
