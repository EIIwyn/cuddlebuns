import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_DIR = path.resolve(__dirname, '../../assets');
const SUPPORTED_FORMATS = ['.png', '.jpg', '.jpeg'];
const OUTPUT_FORMATS = ['webp', 'avif']; // Both for maximum compatibility

// Check if Sharp is available
async function checkDependencies() {
  try {
    await import('sharp');
    return true;
  } catch {
    console.log('⚠️  Sharp library not found. Installing...');
    console.log('   Run: npm install --save-dev sharp');
    return false;
  }
}

// Convert a single image to modern formats
async function convertImage(inputPath, outputFormat) {
  const sharp = (await import('sharp')).default;
  const ext = path.extname(inputPath);
  const outputPath = inputPath.replace(ext, `.${outputFormat}`);

  // Skip if output already exists and is newer
  if (fs.existsSync(outputPath)) {
    const inputStats = fs.statSync(inputPath);
    const outputStats = fs.statSync(outputPath);
    if (outputStats.mtime > inputStats.mtime) {
      return { skipped: true, path: outputPath };
    }
  }

  try {
    const image = sharp(inputPath);

    if (outputFormat === 'webp') {
      await image
        .webp({
          quality: 85,
          effort: 6 // 0-6, higher = better compression but slower
        })
        .toFile(outputPath);
    } else if (outputFormat === 'avif') {
      await image
        .avif({
          quality: 75,
          effort: 6 // 0-9, higher = better compression but slower
        })
        .toFile(outputPath);
    }

    const inputSize = fs.statSync(inputPath).size;
    const outputSize = fs.statSync(outputPath).size;
    const savings = ((1 - outputSize / inputSize) * 100).toFixed(1);

    return {
      success: true,
      path: outputPath,
      inputSize,
      outputSize,
      savings,
      format: outputFormat
    };
  } catch (error) {
    return {
      error: true,
      path: outputPath,
      message: error.message
    };
  }
}

// Find all images to convert
function findImages(dir, options = {}) {
  const { skipRefSheets = true } = options;
  const images = [];

  function scan(currentDir) {
    const items = fs.readdirSync(currentDir);

    items.forEach(item => {
      const itemPath = path.join(currentDir, item);
      const stats = fs.statSync(itemPath);

      if (stats.isDirectory()) {
        scan(itemPath);
      } else {
        const ext = path.extname(item).toLowerCase();
        if (SUPPORTED_FORMATS.includes(ext)) {
          // Skip reference sheets if option is enabled
          if (skipRefSheets && itemPath.includes('referencesheets')) {
            return;
          }
          images.push(itemPath);
        }
      }
    });
  }

  scan(dir);
  return images;
}

// Main conversion function
async function convertImages(options = {}) {
  const {
    formats = OUTPUT_FORMATS,
    skipRefSheets = true,
    verbose = true
  } = options;

  console.log('🔍 Checking dependencies...');
  const hasSharp = await checkDependencies();
  if (!hasSharp) {
    console.log('\n❌ Please install sharp: npm install --save-dev sharp');
    return { success: false };
  }

  console.log('✅ Sharp library found\n');

  console.log('📁 Scanning for images...');
  const images = findImages(ASSETS_DIR, { skipRefSheets });

  if (skipRefSheets) {
    console.log('   ℹ️  Skipping reference sheets (use --include-refsheets to convert them)');
  }
  console.log(`   Found ${images.length} images to process\n`);

  const results = {
    converted: 0,
    skipped: 0,
    errors: 0,
    totalSavings: 0,
    details: []
  };

  let processed = 0;
  for (const imagePath of images) {
    const relativePath = path.relative(ASSETS_DIR, imagePath);
    processed++;

    if (verbose) {
      process.stdout.write(`[${processed}/${images.length}] ${relativePath.substring(0, 60)}...`);
    }

    for (const format of formats) {
      const result = await convertImage(imagePath, format);

      if (result.skipped) {
        results.skipped++;
        if (verbose) process.stdout.write(' ⏭️');
      } else if (result.error) {
        results.errors++;
        results.details.push({
          file: relativePath,
          error: result.message
        });
        if (verbose) process.stdout.write(' ❌');
      } else if (result.success) {
        results.converted++;
        results.totalSavings += (result.inputSize - result.outputSize);
        results.details.push({
          file: relativePath,
          format: result.format,
          savings: result.savings,
          inputSize: result.inputSize,
          outputSize: result.outputSize
        });
        if (verbose) process.stdout.write(` ✅ ${format.toUpperCase()} (${result.savings}% smaller)`);
      }
    }

    if (verbose) process.stdout.write('\n');
  }

  console.log('\n📊 Conversion Summary:');
  console.log(`   ✅ Converted: ${results.converted}`);
  console.log(`   ⏭️  Skipped: ${results.skipped}`);
  console.log(`   ❌ Errors: ${results.errors}`);
  console.log(`   💾 Total space saved: ${(results.totalSavings / 1024 / 1024).toFixed(2)} MB`);

  if (results.errors > 0) {
    console.log('\n❌ Errors encountered:');
    results.details
      .filter(d => d.error)
      .forEach(d => console.log(`   - ${d.file}: ${d.error}`));
  }

  // Show top savings
  const topSavings = results.details
    .filter(d => !d.error)
    .sort((a, b) => b.inputSize - b.outputSize - (a.inputSize - a.outputSize))
    .slice(0, 5);

  if (topSavings.length > 0) {
    console.log('\n🏆 Top space savings:');
    topSavings.forEach(d => {
      const saved = ((d.inputSize - d.outputSize) / 1024 / 1024).toFixed(2);
      console.log(`   - ${d.file} (${d.format}): ${saved} MB saved (${d.savings}%)`);
    });
  }

  return { success: true, results };
}

// Generate report
function generateReport(results) {
  const reportPath = path.join(__dirname, '../public/data/image-optimization-report.json');

  const report = {
    generated: new Date().toISOString(),
    summary: {
      totalConverted: results.converted,
      totalSkipped: results.skipped,
      totalErrors: results.errors,
      totalSavingsMB: (results.totalSavings / 1024 / 1024).toFixed(2)
    },
    details: results.details
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Report saved to ${path.relative(process.cwd(), reportPath)}`);
}

// CLI interface
const args = process.argv.slice(2);
const options = {
  formats: OUTPUT_FORMATS,
  skipExisting: !args.includes('--force'),
  skipRefSheets: !args.includes('--include-refsheets'),
  verbose: !args.includes('--quiet')
};

if (args.includes('--webp-only')) {
  options.formats = ['webp'];
} else if (args.includes('--avif-only')) {
  options.formats = ['avif'];
}

console.log('🖼️  Modern Image Converter\n');
console.log(`Formats: ${options.formats.join(', ').toUpperCase()}`);
console.log(`Skip existing: ${options.skipExisting}`);
console.log(`Skip reference sheets: ${options.skipRefSheets}\n`);

convertImages(options)
  .then(({ success, results }) => {
    if (success && results) {
      generateReport(results);
      console.log('\n✨ Conversion completed successfully!');
      process.exit(0);
    } else {
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('\n❌ Conversion failed:', error);
    process.exit(1);
  });

export { convertImages, findImages };
