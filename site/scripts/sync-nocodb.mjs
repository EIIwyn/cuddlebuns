import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SITE_DIR = path.resolve(import.meta.dirname, "..");
const CACHE_DIR = path.join(SITE_DIR, ".cache", "nocodb");
const ORIGINALS_DIR = path.join(CACHE_DIR, "originals");
const MANIFEST_FILE = path.join(CACHE_DIR, "manifest.json");
const DATA_DIR = path.join(SITE_DIR, "public", "data", "cms");
const GALLERY_DIR = path.join(DATA_DIR, "gallery");
const IMAGE_DIR = path.join(SITE_DIR, "public", "generated", "nocodb", "images");
const PUBLIC_IMAGE_ROOT = "/generated/nocodb/images";
const CHECK_ONLY = process.argv.includes("--check");
const MANIFEST_VERSION = 1;
const DERIVATIVE_WIDTHS = [480, 960, 1600];
const PALETTE = ["#7be3f2", "#f29bd4", "#b6e36f", "#b9a4ff", "#ffb86b", "#74d8b4"];

function loadEnvironment() {
  const envFile = path.join(SITE_DIR, ".env.local");
  if (!fs.existsSync(envFile)) return;

  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function getConfig() {
  const names = {
    url: "NOCODB_URL",
    token: "NOCODB_TOKEN",
    baseId: "NOCODB_BASE_ID",
    artists: "NOCODB_ARTISTS_TABLE_ID",
    characters: "NOCODB_CHARACTERS_TABLE_ID",
    commissions: "NOCODB_COMMISSIONS_TABLE_ID",
    collections: "NOCODB_COLLECTIONS_TABLE_ID",
    versions: "NOCODB_VERSIONS_TABLE_ID",
  };
  const config = Object.fromEntries(
    Object.entries(names).map(([key, name]) => [key, process.env[name]?.trim()]),
  );
  const missing = Object.entries(config)
    .filter(([, value]) => !value || value.startsWith("YOUR_"))
    .map(([key]) => names[key]);
  if (missing.length) {
    throw new Error(`Missing NocoDB configuration: ${missing.join(", ")}`);
  }
  config.url = config.url.replace(/\/+$/, "");
  return config;
}

function slugify(value, fallback) {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function numericOrder(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
}

function byOrderThenName(left, right) {
  return numericOrder(left.order) - numericOrder(right.order) ||
    String(left.name).localeCompare(String(right.name));
}

function relationIds(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => String(item?.id ?? "")).filter(Boolean);
}

function attachmentSnapshot(attachment) {
  return {
    id: attachment?.id ?? null,
    path: attachment?.path ?? null,
    title: attachment?.title ?? null,
    mimetype: attachment?.mimetype ?? null,
    size: attachment?.size ?? null,
    width: attachment?.width ?? null,
    height: attachment?.height ?? null,
  };
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function fingerprint(value) {
  return hash(JSON.stringify(stableValue(value)));
}

function colorFor(value) {
  const digest = hash(String(value));
  return PALETTE[Number.parseInt(digest.slice(0, 8), 16) % PALETTE.length];
}

function accentColor(value, fallbackSeed) {
  const color = typeof value === "string" ? value.trim() : "";
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return `#${[...color.slice(1)].map((digit) => digit.repeat(2)).join("")}`.toLowerCase();
  }
  return colorFor(fallbackSeed);
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

async function fetchTable(config, tableId, label) {
  const records = [];
  const origin = new URL(config.url).origin;
  let next = `${config.url}/api/v3/data/${encodeURIComponent(config.baseId)}/` +
    `${encodeURIComponent(tableId)}/records?pageSize=100&linksAsLtar=true`;

  while (next) {
    const url = new URL(next, `${config.url}/`);
    if (url.origin !== origin) throw new Error(`${label} pagination changed hosts.`);
    const response = await fetch(url, {
      headers: { "xc-token": config.token },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`${label} request failed: ${response.status} ${response.statusText}\n${detail}`);
    }
    const page = await response.json();
    records.push(...(page.records ?? []));
    next = page.next ?? null;
  }
  return records;
}

function publicSourceSnapshot(tables) {
  const wanted = {
    collections: ["Name", "Slug", "Display Order", "Visible", "Collapsible", "Characters"],
    characters: ["Name", "Slug", "Subtitle", "Accent Color", "Display Order", "Visible", "Versions", "Project", "Social 1 Label", "Social 1 URL"],
    versions: ["Name", "Slug", "Reference Sheet", "Display Order", "Visible", "Character", "Commissions"],
    commissions: ["Image", "Source URL", "Type", "Date", "Published", "Display Order", "Versions", "Artists"],
    artists: ["Artist Name", "URL"],
  };

  return Object.fromEntries(Object.entries(tables).map(([table, records]) => [
    table,
    records.map((record) => ({
      id: record.id,
      fields: Object.fromEntries(wanted[table].map((name) => {
        const value = record.fields?.[name];
        if (name === "Image" || name === "Reference Sheet") {
          return [name, Array.isArray(value) ? value.map(attachmentSnapshot) : []];
        }
        if (["Characters", "Versions", "Project", "Commissions", "Artists"].includes(name)) {
          return [name, relationIds(value).sort()];
        }
        return [name, value ?? null];
      })),
    })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
  ]));
}

function createModel(tables, config) {
  const errors = [];
  const imageTasks = new Map();
  const artistById = new Map(tables.artists.map((record) => [String(record.id), record]));

  const collections = tables.collections
    .filter((record) => record.fields?.Visible === true)
    .map((record) => ({
      id: String(record.id),
      name: String(record.fields?.Name ?? "Untitled collection"),
      slug: slugify(record.fields?.Slug || record.fields?.Name, `collection-${record.id}`),
      order: record.fields?.["Display Order"] ?? null,
      collapsible: record.fields?.Collapsible === true,
      characters: [],
    }));
  const collectionById = new Map(collections.map((item) => [item.id, item]));

  const characters = tables.characters
    .filter((record) => record.fields?.Visible === true)
    .map((record) => {
      const name = String(record.fields?.Name ?? "Untitled character");
      return {
        id: String(record.id),
        name,
        slug: slugify(record.fields?.Slug || name, `character-${record.id}`),
        subtitle: record.fields?.Subtitle || null,
        order: record.fields?.["Display Order"] ?? null,
        color: accentColor(record.fields?.["Accent Color"], record.fields?.Slug || name),
        collectionId: relationIds(record.fields?.Project)[0] ?? null,
        social: record.fields?.["Social 1 URL"] ? {
          label: record.fields?.["Social 1 Label"] || "Profile",
          url: record.fields["Social 1 URL"],
        } : null,
        versions: [],
      };
    })
    .filter((character) => collectionById.has(character.collectionId));
  const characterById = new Map(characters.map((item) => [item.id, item]));

  const versions = tables.versions
    .filter((record) => record.fields?.Visible === true)
    .map((record) => {
      const characterId = relationIds(record.fields?.Character)[0] ?? null;
      const character = characterById.get(characterId);
      const name = String(record.fields?.Name ?? "Default");
      const slug = slugify(record.fields?.Slug || name, `version-${record.id}`);
      return {
        id: String(record.id),
        name,
        slug,
        order: record.fields?.["Display Order"] ?? null,
        characterId,
        galleryUrl: character ? `/data/cms/gallery/${character.slug}--${slug}.json` : null,
        commissionCount: 0,
        referenceSheets: [],
        referenceAttachments: Array.isArray(record.fields?.["Reference Sheet"])
          ? record.fields["Reference Sheet"] : [],
      };
    })
    .filter((version) => characterById.has(version.characterId));
  const versionById = new Map(versions.map((item) => [item.id, item]));

  for (const version of versions) {
    for (const [index, attachment] of version.referenceAttachments.entries()) {
      if (!attachment?.signedPath) {
        errors.push(`Version ${version.id}: reference sheet ${index + 1} has no downloadable path.`);
        continue;
      }
      const taskKey = `reference:${version.id}:${attachment.id ?? index}`;
      imageTasks.set(taskKey, { key: taskKey, attachment, sourceUrl: new URL(attachment.signedPath, `${config.url}/`).href });
      version.referenceSheets.push({ taskKey });
    }
    delete version.referenceAttachments;
  }

  const galleries = new Map(versions.map((version) => [version.id, []]));
  for (const record of tables.commissions) {
    const fields = record.fields ?? {};
    if (fields.Published !== true) continue;

    const label = `Commission ${record.id}${fields.Title ? ` (${fields.Title})` : ""}`;
    const type = typeof fields.Type === "string" ? fields.Type.trim() : "";
    const sourceUrl = typeof fields["Source URL"] === "string" ? fields["Source URL"].trim() : "";
    const attachments = Array.isArray(fields.Image) ? fields.Image : [];
    const linkedVersionIds = relationIds(fields.Versions).filter((id) => versionById.has(id));
    const linkedArtists = relationIds(fields.Artists)
      .map((id) => artistById.get(id))
      .filter(Boolean)
      .map((artist) => ({
        name: String(artist.fields?.["Artist Name"] ?? "").trim(),
        url: artist.fields?.URL || null,
      }))
      .filter((artist) => artist.name);

    const problems = [];
    if (!type) problems.push("Type");
    if (!sourceUrl) problems.push("Source URL");
    if (!attachments.length) problems.push("Image");
    if (!linkedVersionIds.length) problems.push("at least one visible Version");
    if (!linkedArtists.length) problems.push("Artist");
    if (problems.length) {
      errors.push(`${label}: missing ${problems.join(", ")}; skipped.`);
      continue;
    }

    attachments.forEach((attachment, attachmentIndex) => {
      if (!attachment?.signedPath) {
        errors.push(`${label}: image ${attachmentIndex + 1} has no downloadable path; skipped.`);
        return;
      }
      const taskKey = `commission:${record.id}:${attachment.id ?? attachmentIndex}`;
      imageTasks.set(taskKey, { key: taskKey, attachment, sourceUrl: new URL(attachment.signedPath, `${config.url}/`).href });
      const item = {
        id: `${record.id}-${attachment.id ?? attachmentIndex}`,
        recordId: String(record.id),
        title: type,
        type,
        artist: linkedArtists.map((artist) => artist.name).join(", "),
        artists: linkedArtists,
        sourceUrl,
        date: fields.Date || null,
        displayOrder: fields["Display Order"] ?? null,
        taskKey,
      };
      for (const versionId of linkedVersionIds) galleries.get(versionId).push({ ...item });
    });
  }

  for (const collection of collections) {
    collection.characters = characters.filter((character) => character.collectionId === collection.id);
  }
  for (const character of characters) {
    character.versions = versions.filter((version) => version.characterId === character.id);
  }
  for (const version of versions) {
    const items = galleries.get(version.id);
    items.sort((left, right) =>
      numericOrder(left.displayOrder) - numericOrder(right.displayOrder) ||
      String(right.date ?? "").localeCompare(String(left.date ?? "")) ||
      left.id.localeCompare(right.id),
    );
    version.commissionCount = items.length;
  }

  collections.sort(byOrderThenName);
  for (const collection of collections) collection.characters.sort(byOrderThenName);
  for (const character of characters) character.versions.sort(byOrderThenName);

  return { collections, galleries, versions, imageTasks, errors };
}

function extensionFor(attachment) {
  const mime = {
    "image/avif": ".avif", "image/gif": ".gif", "image/jpeg": ".jpg",
    "image/png": ".png", "image/webp": ".webp",
  }[attachment?.mimetype];
  if (mime) return mime;
  const extension = path.extname(attachment?.title || "").toLowerCase();
  return /^\.(avif|gif|jpe?g|png|webp)$/.test(extension) ? extension : ".img";
}

async function downloadTask(task) {
  const response = await fetch(task.sourceUrl, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`Image ${task.key} failed: ${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

function publicUrl(filename) {
  return `${PUBLIC_IMAGE_ROOT}/${filename}`;
}

function fileExists(relativePublicUrl) {
  if (!relativePublicUrl?.startsWith(PUBLIC_IMAGE_ROOT)) return false;
  return fs.existsSync(path.join(SITE_DIR, "public", relativePublicUrl.slice(1)));
}

function cachedEntryIsComplete(entry) {
  if (!entry?.image?.fallback?.url || !fileExists(entry.image.fallback.url)) return false;
  return ["avif", "webp"].every((format) =>
    entry.image.sources?.[format]?.every((source) => fileExists(source.url)),
  ) && (!entry.image.originalUrl || fileExists(entry.image.originalUrl));
}

async function processImage(task, previous) {
  const signature = fingerprint(attachmentSnapshot(task.attachment));
  if (previous?.signature === signature && cachedEntryIsComplete(previous)) return previous;

  const buffer = await downloadTask(task);
  const contentHash = hash(buffer);
  const sourceExtension = extensionFor(task.attachment);
  fs.mkdirSync(ORIGINALS_DIR, { recursive: true });
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const cacheFile = path.join(ORIGINALS_DIR, `${contentHash}${sourceExtension}`);
  if (!fs.existsSync(cacheFile)) fs.writeFileSync(cacheFile, buffer);

  const stem = `${slugify(task.key, "image")}-${contentHash.slice(0, 12)}`;
  const sources = { avif: [], webp: [] };
  for (const width of DERIVATIVE_WIDTHS) {
    for (const format of ["avif", "webp"]) {
      const filename = `${stem}-${width}.${format}`;
      const output = path.join(IMAGE_DIR, filename);
      let info;
      if (fs.existsSync(output)) {
        info = await sharp(output).metadata();
      } else {
        const pipeline = sharp(buffer, { animated: false }).rotate().resize({ width, withoutEnlargement: true });
        info = format === "avif"
          ? await pipeline.avif({ quality: 65, effort: 5 }).toFile(output)
          : await pipeline.webp({ quality: 80, effort: 5 }).toFile(output);
      }
      if (!sources[format].some((source) => source.width === info.width)) {
        sources[format].push({ url: publicUrl(filename), width: info.width, height: info.height });
      } else if (fs.existsSync(output)) {
        fs.unlinkSync(output);
      }
    }
  }
  for (const values of Object.values(sources)) values.sort((a, b) => a.width - b.width);
  const fallback = sources.webp.at(-1);
  const image = {
    width: fallback.width,
    height: fallback.height,
    aspectRatio: Number((fallback.width / fallback.height).toFixed(5)),
    sources,
    fallback,
  };
  if (task.attachment?.mimetype === "image/gif") {
    const originalFilename = `${stem}-original.gif`;
    const originalOutput = path.join(IMAGE_DIR, originalFilename);
    if (!fs.existsSync(originalOutput)) fs.copyFileSync(cacheFile, originalOutput);
    image.originalUrl = publicUrl(originalFilename);
  }
  return { signature, contentHash, image };
}

async function mapWithConcurrency(items, concurrency, operation) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await operation(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return output;
}

function imageOutputFiles(image) {
  return [
    ...Object.values(image.sources ?? {}).flat().map((source) => source.url),
    image.originalUrl,
  ].filter(Boolean);
}

function pruneGeneratedFiles(allowedUrls, allowedGalleryFiles) {
  if (fs.existsSync(IMAGE_DIR)) {
    for (const name of fs.readdirSync(IMAGE_DIR)) {
      const file = path.join(IMAGE_DIR, name);
      if (fs.statSync(file).isFile() && !allowedUrls.has(publicUrl(name))) fs.unlinkSync(file);
    }
  }
  if (fs.existsSync(GALLERY_DIR)) {
    for (const name of fs.readdirSync(GALLERY_DIR)) {
      const file = path.join(GALLERY_DIR, name);
      if (path.extname(name) === ".json" && !allowedGalleryFiles.has(file)) fs.unlinkSync(file);
    }
  }
}

async function main() {
  loadEnvironment();
  const config = getConfig();
  console.log("Fetching Collections, Characters, Versions, Commissions, and Artists...");
  const [collections, characters, versions, commissions, artists] = await Promise.all([
    fetchTable(config, config.collections, "Collections"),
    fetchTable(config, config.characters, "Characters"),
    fetchTable(config, config.versions, "Versions"),
    fetchTable(config, config.commissions, "Commissions"),
    fetchTable(config, config.artists, "Artists"),
  ]);
  const tables = { collections, characters, versions, commissions, artists };
  const sourceFingerprint = fingerprint(publicSourceSnapshot(tables));
  const previous = readJson(MANIFEST_FILE, { attachments: {} });
  const model = createModel(tables, config);
  const expectedSite = path.join(DATA_DIR, "site.json");
  const missingGalleryOutputs = [...model.versions].filter((version) =>
    !fs.existsSync(path.join(SITE_DIR, "public", version.galleryUrl.slice(1))),
  );
  const outputPresent = fs.existsSync(expectedSite) && missingGalleryOutputs.length === 0;
  const incompleteCachedTasks = [...model.imageTasks.keys()].filter((key) =>
    !cachedEntryIsComplete(previous.attachments?.[key]),
  );
  const unchanged = previous.version === MANIFEST_VERSION &&
    previous.sourceFingerprint === sourceFingerprint && outputPresent &&
    incompleteCachedTasks.length === 0;

  if (CHECK_ONLY) {
    console.log(unchanged ? "No public NocoDB changes detected." : "Public NocoDB changes detected.");
    if (!unchanged) {
      if (previous.sourceFingerprint !== sourceFingerprint) console.log("- Public record data changed.");
      if (!fs.existsSync(expectedSite)) console.log("- site.json is missing.");
      if (missingGalleryOutputs.length) console.log(`- ${missingGalleryOutputs.length} gallery output(s) are missing.`);
      if (incompleteCachedTasks.length) console.log(`- ${incompleteCachedTasks.length} cached image output(s) are missing.`);
    }
    process.exitCode = unchanged ? 0 : 10;
    return;
  }
  if (unchanged) {
    console.log("No public NocoDB changes detected; generated files are current.");
    return;
  }

  if (model.errors.length) {
    console.warn(`Skipped ${model.errors.length} invalid public record issue(s):`);
    for (const error of model.errors) console.warn(`- ${error}`);
  }

  const tasks = [...model.imageTasks.values()];
  let processed = 0;
  const entries = await mapWithConcurrency(tasks, 3, async (task) => {
    const oldEntry = previous.attachments?.[task.key];
    const entry = await processImage(task, oldEntry);
    if (entry !== oldEntry) processed += 1;
    return [task.key, entry];
  });
  const attachmentEntries = Object.fromEntries(entries);
  const resolveImage = ({ taskKey }) => attachmentEntries[taskKey].image;
  const allowedGalleryFiles = new Set();

  for (const version of model.versions) {
    version.referenceSheets = version.referenceSheets.map(resolveImage);
    const character = [...model.collections]
      .flatMap((collection) => collection.characters)
      .find((item) => item.id === version.characterId);
    const items = model.galleries.get(version.id).map((item) => {
      const { taskKey, ...publicItem } = item;
      return { ...publicItem, image: attachmentEntries[taskKey].image };
    });
    const galleryFile = path.join(SITE_DIR, "public", version.galleryUrl.slice(1));
    allowedGalleryFiles.add(galleryFile);
    writeJsonAtomic(galleryFile, {
      schemaVersion: 1,
      character: { id: character.id, name: character.name, slug: character.slug, color: character.color },
      version: { id: version.id, name: version.name, slug: version.slug },
      commissions: items,
    });
  }

  const siteCollections = model.collections.map((collection) => ({
    ...collection,
    characters: collection.characters.map((character) => ({
      ...character,
      versions: character.versions.map(({ characterId: _characterId, ...version }) => version),
    })),
  }));
  writeJsonAtomic(expectedSite, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    collections: siteCollections,
  });

  const allowedUrls = new Set(Object.values(attachmentEntries).flatMap((entry) => imageOutputFiles(entry.image)));
  pruneGeneratedFiles(allowedUrls, allowedGalleryFiles);
  writeJsonAtomic(MANIFEST_FILE, {
    version: MANIFEST_VERSION,
    sourceFingerprint,
    attachments: attachmentEntries,
  });
  const commissionImages = [...model.galleries.values()].reduce((sum, items) => sum + items.length, 0);
  console.log(`Generated ${model.versions.length} gallery files with ${commissionImages} version-linked images.`);
  console.log(`Processed ${processed} changed image attachment(s); reused ${tasks.length - processed}.`);
  console.log("Wrote public/data/cms/site.json.");
}

main().catch((error) => {
  console.error(`NocoDB sync failed: ${error.message}`);
  process.exitCode = 1;
});
