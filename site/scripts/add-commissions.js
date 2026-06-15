import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_DIR = path.resolve(__dirname, '../../assets');
const CHARACTERS_DIR = path.resolve(__dirname, '../public/data/characters');
const ROOT_CHARACTERS_DIR = path.resolve(__dirname, '../../public/data/characters');
const ROOT_CHARACTERS_EXISTS = fs.existsSync(ROOT_CHARACTERS_DIR);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

// Find character file by folder name
function findCharacterFile(folderName) {
  const files = fs.readdirSync(CHARACTERS_DIR);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const filePath = path.join(CHARACTERS_DIR, file);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // Match by name similarity
    const normalizedName = content.name.toLowerCase().replace(/\s+/g, '_');
    if (normalizedName === folderName.toLowerCase()) {
      return { file, content, filePath };
    }
  }

  return null;
}

// Get next commission ID
function getNextId(character) {
  let maxId = 0;

  for (const version of (character.versions || [])) {
    for (const commission of (version.commissions || [])) {
      if (commission.id > maxId) {
        maxId = commission.id;
      }
    }
  }

  return maxId + 1;
}

// Simple asset scanner (inline version)
function scanAssets() {
  const discovered = { commissions: {} };

  const commissionsDir = path.join(ASSETS_DIR, 'commissions');
  if (!fs.existsSync(commissionsDir)) {
    return discovered;
  }

  const characterFolders = fs.readdirSync(commissionsDir);

  characterFolders.forEach(charFolder => {
    const charPath = path.join(commissionsDir, charFolder);
    if (!fs.statSync(charPath).isDirectory()) return;

    discovered.commissions[charFolder] = [];

    function scanCharFolder(folderPath, relativePath = '') {
      const items = fs.readdirSync(folderPath);

      items.forEach(item => {
        const itemPath = path.join(folderPath, item);
        const relativeItemPath = path.join(relativePath, item);

        if (fs.statSync(itemPath).isDirectory()) {
          scanCharFolder(itemPath, relativeItemPath);
        } else if (/\.(png|jpg|jpeg|gif)$/i.test(item)) {
          const stats = fs.statSync(itemPath);
          const match = item.match(/^@([^.-]+)/);
          const artist = match ? `@${match[1]}` : null;

          discovered.commissions[charFolder].push({
            filename: item,
            path: `/assets/commissions/${charFolder}/${relativeItemPath.replace(/\\/g, '/')}`,
            artist,
            metadata: {
              fileSize: stats.size,
              format: path.extname(item).replace('.', '')
            },
            subfolder: relativePath || null
          });
        }
      });
    }

    scanCharFolder(charPath);
  });

  return discovered;
}

// Check if image is already in character data
function isImageInCharacter(imagePath, character) {
  for (const version of (character.versions || [])) {
    for (const commission of (version.commissions || [])) {
      if (commission.image === imagePath) {
        return true;
      }
    }
  }
  return false;
}

async function addCommissionsInteractive() {
  console.log('\n🎨 Interactive Commission Adder\n');

  // Scan for new images
  console.log('📁 Scanning for new images...');
  const discovered = scanAssets();

  // Load character files and find new images
  const characterFiles = fs.readdirSync(CHARACTERS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const filePath = path.join(CHARACTERS_DIR, f);
      return {
        file: f,
        filePath,
        content: JSON.parse(fs.readFileSync(filePath, 'utf8'))
      };
    });

  // Find new images not in character files
  const newImages = {};
  Object.entries(discovered.commissions).forEach(([charFolder, images]) => {
    newImages[charFolder] = [];

    // Find matching character
    const charData = characterFiles.find(cf => {
      const normalizedName = cf.content.name.toLowerCase().replace(/\s+/g, '_');
      return normalizedName === charFolder.toLowerCase();
    });

    if (!charData) {
      newImages[charFolder] = images; // No character file, all are new
      return;
    }

    // Filter out images already in character data
    newImages[charFolder] = images.filter(img => {
      return !isImageInCharacter(img.path, charData.content);
    });
  });

  // Flatten all new images into a single array with their folder context
  const allNewImages = [];
  Object.entries(newImages).forEach(([charFolder, images]) => {
    images.forEach(img => {
      allNewImages.push({ ...img, detectedFolder: charFolder });
    });
  });

  // Check if there are any images
  if (allNewImages.length === 0) {
    console.log('✅ No new images found!');
    rl.close();
    return;
  }

  console.log(`\nFound ${allNewImages.length} new image${allNewImages.length > 1 ? 's' : ''}\n`);

  // Process each image
  for (let i = 0; i < allNewImages.length; i++) {
    const img = allNewImages[i];
    const charFolder = img.detectedFolder;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📸 Image ${i + 1} of ${allNewImages.length}: ${img.filename}`);
    console.log('='.repeat(60));
    console.log(`   Path: ${img.path}`);
    console.log(`   Artist: ${img.artist || '(not detected)'}`);
    console.log(`   Size: ${(img.metadata?.fileSize / 1024).toFixed(2)} KB`);
    console.log(`   Format: ${img.metadata?.format.toUpperCase()}`);
    console.log(`   Subfolder: ${img.subfolder || '(root)'}`);

    // Guess character from folder
    const guessedCharData = findCharacterFile(charFolder);
    if (guessedCharData) {
      console.log(`\n🔍 Detected character: ${guessedCharData.content.name} (from folder '${charFolder}')`);
    }

    const add = await question('\nAdd this commission? (y/n): ');
    if (add.toLowerCase() !== 'y') {
      console.log('⏭️  Skipped');
      continue;
    }

    // Ask if the detected character is correct
    let charData = guessedCharData;
    if (guessedCharData) {
      const confirmChar = await question(`Is this the correct character? (y/n): `);
      if (confirmChar.toLowerCase() !== 'y') {
        charData = null; // Need to select manually
      }
    }

    // If no guess or user rejected guess, show all characters
    if (!charData) {
      console.log('\nAvailable characters:');
      characterFiles.forEach((cf, idx) => {
        console.log(`  ${idx + 1}. ${cf.content.name}`);
      });

      const charChoice = await question(`\nSelect character (1-${characterFiles.length}): `);
      const charIndex = parseInt(charChoice) - 1;

      if (charIndex < 0 || charIndex >= characterFiles.length) {
        console.log('❌ Invalid choice, skipping this image.');
        continue;
      }

      charData = characterFiles[charIndex];
    }

    // Ask which version to add to
    const versions = charData.content.versions || [];
    if (versions.length === 0) {
      console.log('❌ Character has no versions defined');
      continue;
    }

    console.log(`\nCharacter: ${charData.content.name}`);
    console.log('Available versions:');
    versions.forEach((v, i) => {
      console.log(`  ${i + 1}. ${v.name || v.id}`);
    });

    const versionChoice = await question(`\nAdd to which version? (1-${versions.length}): `);
    const versionIndex = parseInt(versionChoice) - 1;

    if (versionIndex < 0 || versionIndex >= versions.length) {
      console.log('❌ Invalid choice, skipping this image.');
      continue;
    }

    const selectedVersion = versions[versionIndex];
    console.log(`\nAdding to version: ${selectedVersion.name || selectedVersion.id}`);

    // Get source URL
    const sourceUrl = await question('Source URL (Twitter/Skeb link): ');

    if (!sourceUrl.trim()) {
      console.log('⚠️  Skipping - no source URL provided');
      continue;
    }

    // Create commission entry
    const nextId = getNextId(charData.content);
    const newCommission = {
      id: nextId,
      artist: img.artist || await question('Artist name (with @): '),
      image: img.path,
      sourceUrl: sourceUrl.trim()
    };

    // Add to character data
    if (!selectedVersion.commissions) {
      selectedVersion.commissions = [];
    }
    selectedVersion.commissions.push(newCommission);

    console.log(`✅ Added commission #${nextId} to ${charData.content.name}`);

    // Save the updated character file in the site data directory
    const formattedJson = JSON.stringify(charData.content, null, 2) + '\n';
    fs.writeFileSync(charData.filePath, formattedJson, 'utf8');
    console.log(`💾 Saved ${charData.file} in site/public/data/characters`);

    if (ROOT_CHARACTERS_EXISTS) {
      const rootFilePath = path.join(ROOT_CHARACTERS_DIR, charData.file);
      fs.writeFileSync(rootFilePath, formattedJson, 'utf8');
      console.log(`💾 Saved ${charData.file} in public/data/characters`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('✨ Done! Run "npm run build:data" to regenerate characters.json');
  console.log('='.repeat(60));

  rl.close();
}

// Run
addCommissionsInteractive().catch(error => {
  console.error('❌ Error:', error);
  rl.close();
  process.exit(1);
});
