import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHARACTERS_DIR = path.resolve(__dirname, '../public/data/characters');

/**
 * Renumber commission IDs to be sequential (1, 2, 3, ...)
 * This script updates all character JSON files to ensure commission IDs are sequential
 * based on their current order in the array.
 */
function renumberCommissionIds() {
  console.log('🔢 Starting commission ID renumbering...\n');

  // Get all character JSON files
  const characterFiles = fs.readdirSync(CHARACTERS_DIR)
    .filter(file => file.endsWith('.json'));

  if (characterFiles.length === 0) {
    console.log('❌ No character JSON files found in:', CHARACTERS_DIR);
    return;
  }

  let totalUpdated = 0;

  characterFiles.forEach(file => {
    const filePath = path.join(CHARACTERS_DIR, file);
    console.log(`📄 Processing: ${file}`);

    try {
      // Read the character data
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      let fileUpdated = false;

      // Process each version
      if (data.versions && Array.isArray(data.versions)) {
        data.versions.forEach(version => {
          if (version.commissions && Array.isArray(version.commissions)) {
            const originalLength = version.commissions.length;

            // Check for duplicate IDs
            const idCounts = {};
            const duplicates = [];
            version.commissions.forEach((commission) => {
              const id = commission.id;
              idCounts[id] = (idCounts[id] || 0) + 1;
              if (idCounts[id] === 2) {
                duplicates.push(id);
              }
            });

            if (duplicates.length > 0) {
              console.log(`  ⚠️  ${version.name}: Found duplicate IDs: ${duplicates.join(', ')}`);
            }

            // Renumber commissions sequentially
            let hasChanges = false;
            version.commissions.forEach((commission, index) => {
              const newId = index + 1;
              if (commission.id !== newId) {
                console.log(`  ├─ ${version.name}: Commission ${commission.id} → ${newId}`);
                commission.id = newId;
                hasChanges = true;
              }
            });

            if (hasChanges) {
              console.log(`  └─ Updated ${version.name} (${originalLength} commissions)`);
              fileUpdated = true;
            } else {
              console.log(`  └─ ${version.name} already sequential (${originalLength} commissions)`);
            }
          }
        });
      }

      // Write back to file if updated
      if (fileUpdated) {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
        console.log(`✅ Updated: ${file}\n`);
        totalUpdated++;
      } else {
        console.log(`⏭️  Skipped: ${file} (no changes needed)\n`);
      }

    } catch (error) {
      console.error(`❌ Error processing ${file}:`, error.message);
    }
  });

  console.log(`\n🎉 Done! Updated ${totalUpdated} of ${characterFiles.length} character files.`);
}

// Run the script
renumberCommissionIds();
