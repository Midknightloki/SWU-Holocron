#!/usr/bin/env node

/**
 * Test Structure Analyzer
 * Analyzes the advanced search test file for completeness
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testFile = join(__dirname, 'src', 'test', 'integration', 'advancedSearch.test.js');

console.log('🔍 Analyzing Advanced Search Test Coverage\n');
console.log('='.repeat(60));

try {
  const content = readFileSync(testFile, 'utf-8');
  
  // Extract test structure
  const describeBlocks = [];
  const lines = content.split('\n');
  
  let currentDescribe = null;
  let itCount = 0;
  
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    
    // Match describe blocks
    const describeMatch = trimmed.match(/describe\(['"`]([^'"`]+)['"`]/);
    if (describeMatch) {
      if (currentDescribe && itCount > 0) {
        describeBlocks.push({ name: currentDescribe, tests: itCount });
      }
      currentDescribe = describeMatch[1];
      itCount = 0;
    }
    
    // Match it/test blocks
    const itMatch = trimmed.match(/it\(['"`]([^'"`]+)['"`]/);
    if (itMatch && currentDescribe) {
      itCount++;
    }
  });
  
  // Add last describe block
  if (currentDescribe && itCount > 0) {
    describeBlocks.push({ name: currentDescribe, tests: itCount });
  }
  
  // Display results
  console.log('\n📊 Test Suite Breakdown:\n');
  
  let totalTests = 0;
  describeBlocks.forEach((block, index) => {
    console.log(`${index + 1}. ${block.name}`);
    console.log(`   Tests: ${block.tests}`);
    totalTests += block.tests;
  });
  
  console.log('\n' + '='.repeat(60));
  console.log(`\n✅ Total Describe Blocks: ${describeBlocks.length}`);
  console.log(`✅ Total Test Cases: ${totalTests}`);
  
  // Count assertions
  const expectCount = (content.match(/expect\(/g) || []).length;
  console.log(`✅ Total Assertions: ${expectCount}`);
  
  // Check for important patterns
  const patterns = {
    'beforeEach setup': /beforeEach\s*\(\s*\(\s*\)\s*=>/,
    'Filter logic': /\.filter\(/g,
    'Edge case handling': /if\s*\(\s*!card\s*\)/,
    'Set filtering': /card\.Set\s*!==\s*activeSet/,
    'Search matching': /\.toLowerCase\(\)\.includes\(/,
    'Aspect filtering': /card\.Aspects.*includes/,
    'Type filtering': /card\.Type\s*===\s*selectedType/,
    'Performance test': /performance\.now\(\)/
  };
  
  console.log('\n📋 Implementation Coverage:\n');
  
  for (const [name, pattern] of Object.entries(patterns)) {
    const matches = content.match(pattern);
    const count = matches ? matches.length : 0;
    const status = count > 0 ? '✅' : '❌';
    console.log(`${status} ${name}: ${count} occurrence(s)`);
  }
  
  // Analyze test quality
  console.log('\n🎯 Test Quality Metrics:\n');
  
  const metrics = {
    'Average assertions per test': (expectCount / totalTests).toFixed(1),
    'Lines of test code': content.split('\n').length,
    'Mock data scenarios': (content.match(/mockCards\s*=/g) || []).length,
    'Describe nesting levels': describeBlocks.length
  };
  
  for (const [metric, value] of Object.entries(metrics)) {
    console.log(`  • ${metric}: ${value}`);
  }
  
  // Recommendations
  console.log('\n💡 Recommendations:\n');
  
  if (totalTests < 30) {
    console.log('  ⚠️  Consider adding more test cases (current: ' + totalTests + ', recommended: 30+)');
  } else {
    console.log('  ✅ Good test coverage with ' + totalTests + ' test cases');
  }
  
  if (expectCount / totalTests < 2) {
    console.log('  ⚠️  Consider adding more assertions per test');
  } else {
    console.log('  ✅ Good assertion coverage (' + (expectCount / totalTests).toFixed(1) + ' per test)');
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('\n✨ Analysis Complete!\n');
  
} catch (error) {
  console.error('❌ Error analyzing test file:', error.message);
  process.exit(1);
}
