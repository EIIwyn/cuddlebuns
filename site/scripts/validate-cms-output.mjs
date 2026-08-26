import fs from "node:fs";
import path from "node:path";

const SITE_DIR = path.resolve(import.meta.dirname, "..");
const PUBLIC_DIR = path.join(SITE_DIR, "public");
const SITE_FILE = path.join(PUBLIC_DIR, "data", "cms", "site.json");
const errors = [];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    errors.push(`${path.relative(SITE_DIR, file)}: ${error.message}`);
    return null;
  }
}

function requirePublicFile(url, context) {
  if (typeof url !== "string" || !url.startsWith("/")) {
    errors.push(`${context}: invalid public URL.`);
    return;
  }
  const file = path.join(PUBLIC_DIR, url.slice(1));
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    errors.push(`${context}: missing ${url}.`);
  }
}

function validateImage(image, context) {
  if (!image?.fallback?.url || !image?.width || !image?.height) {
    errors.push(`${context}: incomplete responsive image descriptor.`);
    return;
  }
  requirePublicFile(image.fallback.url, context);
  for (const format of ["avif", "webp"]) {
    const sources = image.sources?.[format];
    if (!Array.isArray(sources) || sources.length === 0) {
      errors.push(`${context}: no ${format} sources.`);
      continue;
    }
    for (const source of sources) requirePublicFile(source.url, context);
  }
  if (image.originalUrl) requirePublicFile(image.originalUrl, context);
}

const site = readJson(SITE_FILE);
if (site) {
  if (site.schemaVersion !== 1 || !Array.isArray(site.collections)) {
    errors.push("data/cms/site.json: unsupported schema.");
  } else {
    for (const collection of site.collections) {
      for (const character of collection.characters ?? []) {
        if (!/^#[0-9a-f]{6}$/i.test(character.color ?? "")) {
          errors.push(`${character.slug}: invalid generated accent color.`);
        }
        for (const version of character.versions ?? []) {
          const context = `${character.slug}/${version.slug}`;
          for (const [index, image] of (version.referenceSheets ?? []).entries()) {
            validateImage(image, `${context} reference ${index + 1}`);
          }
          requirePublicFile(version.galleryUrl, `${context} gallery`);
          const gallery = readJson(path.join(PUBLIC_DIR, version.galleryUrl.slice(1)));
          if (!gallery) continue;
          if (gallery.commissions?.length !== version.commissionCount) {
            errors.push(`${context}: commissionCount does not match gallery JSON.`);
          }
          const ids = new Set();
          for (const commission of gallery.commissions ?? []) {
            if (ids.has(commission.id)) errors.push(`${context}: duplicate card ID ${commission.id}.`);
            ids.add(commission.id);
            if (!commission.type || !commission.artist || !commission.sourceUrl) {
              errors.push(`${context}/${commission.id}: missing public card fields.`);
            }
            validateImage(commission.image, `${context}/${commission.id}`);
          }
        }
      }
    }
  }
}

if (fs.existsSync(path.join(PUBLIC_DIR, "data", "cms"))) {
  const publicJson = [SITE_FILE];
  const galleryDir = path.join(PUBLIC_DIR, "data", "cms", "gallery");
  if (fs.existsSync(galleryDir)) {
    publicJson.push(...fs.readdirSync(galleryDir).map((name) => path.join(galleryDir, name)));
  }
  const forbidden = /NOCODB_TOKEN|nc_pat_|signedPath|xc-token|internalTitle|"Title"/;
  for (const file of publicJson) {
    if (forbidden.test(fs.readFileSync(file, "utf8"))) {
      errors.push(`${path.relative(SITE_DIR, file)}: contains a forbidden private/internal field.`);
    }
  }
}

if (errors.length) {
  console.error(`CMS output validation failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("CMS output validation passed.");
}
