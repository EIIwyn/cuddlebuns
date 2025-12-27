import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_DIR = path.resolve(__dirname, '../../assets');
const CHARACTERS_DIR = path.resolve(__dirname, '../public/data/characters');
const OUTPUT_FILE = path.resolve(__dirname, '../public/data/characters.json');

// Helper to get image metadata
function getImageMetadata(imagePath) {
  try {
    const stats = fs.statSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();

    return {
      fileSize: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      format: ext.replace('.', '')
    };
  } catch (error) {
    console.warn(`Warning: Could not read metadata for ${imagePath}:`, error.message);
    return null;
  }
}

// Extract artist name from filename
function extractArtistFromFilename(filename) {
  // Match patterns like @artist.png or @artist-variant.png
  const match = filename.match(/^@([^.-]+)/);
  return match ? `@${match[1]}` : null;
}

// Scan assets directory for images
function scanAssets() {
  const discovered = {
    commissions: {},
    refSheets: []
  };

  // Scan commissions
  const commissionsDir = path.join(ASSETS_DIR, 'commissions');
  if (fs.existsSync(commissionsDir)) {
    const characterFolders = fs.readdirSync(commissionsDir);

    characterFolders.forEach(charFolder => {
      const charPath = path.join(commissionsDir, charFolder);
      if (!fs.statSync(charPath).isDirectory()) return;

      discovered.commissions[charFolder] = [];

      // Recursively find images in character folder
      function scanCharFolder(folderPath, relativePath = '') {
        const items = fs.readdirSync(folderPath);

        items.forEach(item => {
          const itemPath = path.join(folderPath, item);
          const relativeItemPath = path.join(relativePath, item);

          if (fs.statSync(itemPath).isDirectory()) {
            scanCharFolder(itemPath, relativeItemPath);
          } else if (/\.(png|jpg|jpeg|gif|webp|avif)$/i.test(item)) {
            const metadata = getImageMetadata(itemPath);
            const artist = extractArtistFromFilename(item);

            discovered.commissions[charFolder].push({
              filename: item,
              path: `/assets/commissions/${charFolder}/${relativeItemPath.replace(/\\/g, '/')}`,
              artist,
              metadata,
              subfolder: relativePath || null
            });
          }
        });
      }

      scanCharFolder(charPath);
    });
  }

  // Scan reference sheets
  const refSheetsDir = path.join(ASSETS_DIR, 'referencesheets');
  if (fs.existsSync(refSheetsDir)) {
    const files = fs.readdirSync(refSheetsDir);

    files.forEach(file => {
      if (/\.(png|jpg|jpeg|gif|webp|avif)$/i.test(file)) {
        const filePath = path.join(refSheetsDir, file);
        const metadata = getImageMetadata(filePath);

        discovered.refSheets.push({
          filename: file,
          path: `/assets/referencesheets/${file}`,
          metadata
        });
      }
    });
  }

  return discovered;
}

// Load individual character files
function loadCharacterFiles() {
  const characters = [];
  const files = fs.readdirSync(CHARACTERS_DIR);

  files.forEach(file => {
    if (file.endsWith('.json')) {
      const filePath = path.join(CHARACTERS_DIR, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const character = JSON.parse(content);
      characters.push(character);
    }
  });

  // Sort by ID
  return characters.sort((a, b) => a.id - b.id);
}

// Find new images not in character data
function findNewImages(characters, discovered) {
  const newImages = {
    commissions: {},
    unassigned: []
  };

  // Check each discovered commission
  Object.entries(discovered.commissions).forEach(([charFolder, images]) => {
    images.forEach(img => {
      // Try to find this image in any character's data
      let found = false;

      for (const character of characters) {
        for (const version of (character.versions || [])) {
          for (const commission of (version.commissions || [])) {
            if (commission.image === img.path) {
              found = true;
              break;
            }
          }
          if (found) break;
        }
        if (found) break;
      }

      if (!found) {
        if (!newImages.commissions[charFolder]) {
          newImages.commissions[charFolder] = [];
        }
        newImages.commissions[charFolder].push(img);
      }
    });
  });

  // Find unassigned images (no clear character folder match)
  Object.entries(newImages.commissions).forEach(([charFolder, images]) => {
    const matchingChar = characters.find(c =>
      c.name.toLowerCase().replace(/\s+/g, '_') === charFolder.toLowerCase()
    );

    if (!matchingChar && images.length > 0) {
      newImages.unassigned.push({ folder: charFolder, images });
    }
  });

  return newImages;
}

// Enrich character data with metadata
function enrichCharacterData(characters, discovered) {
  return characters.map(character => {
    const enrichedCharacter = { ...character };

    if (enrichedCharacter.versions) {
      enrichedCharacter.versions = enrichedCharacter.versions.map(version => {
        const enrichedVersion = { ...version };

        // Enrich commissions with metadata
        if (enrichedVersion.commissions) {
          enrichedVersion.commissions = enrichedVersion.commissions.map(commission => {
            const imagePath = commission.image;

            // Find metadata from discovered assets
            for (const [charFolder, images] of Object.entries(discovered.commissions)) {
              const match = images.find(img => img.path === imagePath);
              if (match && match.metadata) {
                return {
                  ...commission,
                  metadata: {
                    fileSize: match.metadata.fileSize,
                    format: match.metadata.format,
                    addedDate: match.metadata.created.toISOString()
                  }
                };
              }
            }

            return commission;
          });
        }

        return enrichedVersion;
      });
    }

    return enrichedCharacter;
  });
}

// Main build function
function buildCharacters() {
  console.log('🔍 Scanning assets directory...');
  const discovered = scanAssets();

  console.log(`📁 Found ${Object.keys(discovered.commissions).length} character folders`);
  console.log(`📄 Found ${discovered.refSheets.length} reference sheets`);

  console.log('\n📖 Loading character JSON files...');
  const characters = loadCharacterFiles();
  console.log(`✅ Loaded ${characters.length} characters`);

  console.log('\n🔎 Checking for new images...');
  const newImages = findNewImages(characters, discovered);

  // Report new images
  let hasNewImages = false;
  Object.entries(newImages.commissions).forEach(([charFolder, images]) => {
    if (images.length > 0) {
      hasNewImages = true;
      console.log(`\n🆕 Found ${images.length} new image(s) in ${charFolder}:`);
      images.forEach(img => {
        console.log(`   - ${img.filename}`);
        if (img.artist) {
          console.log(`     Artist (detected): ${img.artist}`);
        }
        if (img.metadata) {
          console.log(`     Size: ${(img.metadata.fileSize / 1024).toFixed(2)} KB`);
          console.log(`     Format: ${img.metadata.format.toUpperCase()}`);
        }
      });
    }
  });

  if (newImages.unassigned.length > 0) {
    console.log('\n⚠️  Found images in unrecognized folders:');
    newImages.unassigned.forEach(({ folder, images }) => {
      console.log(`   - ${folder} (${images.length} image(s))`);
    });
  }

  if (!hasNewImages && newImages.unassigned.length === 0) {
    console.log('✅ No new images found');
  } else {
    console.log('\n💡 Tip: Update the corresponding character JSON files to include these images');
  }

  console.log('\n📝 Enriching character data with metadata...');
  const enrichedCharacters = enrichCharacterData(characters, discovered);

  console.log('\n📦 Building combined characters.json...');
  const output = {
    characters: enrichedCharacters,
    meta: {
      totalCharacters: enrichedCharacters.length,
      totalCommissions: enrichedCharacters.reduce((sum, char) => {
        return sum + (char.versions || []).reduce((vSum, ver) => {
          return vSum + (ver.commissions || []).length;
        }, 0);
      }, 0)
    }
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`✅ Written to ${path.relative(process.cwd(), OUTPUT_FILE)}`);
  console.log(`   Characters: ${output.meta.totalCharacters}`);
  console.log(`   Total commissions: ${output.meta.totalCommissions}`);

  return { success: true, newImages: hasNewImages || newImages.unassigned.length > 0 };
}

// Run if called directly
try {
  const result = buildCharacters();
  if (result.newImages) {
    console.log('\n⚠️  New images detected. Build completed with warnings.');
    process.exit(0); // Exit with 0 even with warnings so build doesn't fail
  } else {
    console.log('\n✨ Build completed successfully!');
    process.exit(0);
  }
} catch (error) {
  console.error('\n❌ Build failed:', error);
  process.exit(1);
}

export { buildCharacters, scanAssets, loadCharacterFiles };
