import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

// Keep libvips conservative on a small VPS. This can be raised later if the server has headroom.
sharp.concurrency(1);

const SITE_DIR = path.resolve(import.meta.dirname, "..");
const CACHE_DIR = path.join(SITE_DIR, ".cache", "nocodb");
const ORIGINALS_DIR = path.join(CACHE_DIR, "originals");
const MANIFEST_FILE = path.join(CACHE_DIR, "manifest.json");
const DATA_DIR = path.join(SITE_DIR, "public", "data", "cms");
const GALLERY_DIR = path.join(DATA_DIR, "gallery");
const IMAGE_DIR = path.join(SITE_DIR, "public", "generated", "nocodb", "images");
const PUBLIC_IMAGE_ROOT = "/generated/nocodb/images";
const CHECK_ONLY = process.argv.includes("--check");
const MANIFEST_VERSION = 2;
const DERIVATIVE_WIDTHS = [480, 960, 1600];
const API_PAGE_SIZE = 10;
const API_TIMEOUT_MS = 120_000;
const IMAGE_TIMEOUT_MS = 600_000;
const IMAGE_MAX_ATTEMPTS = 4;
const IMAGE_RETRY_BASE_MS = 5_000;
const API_MAX_ATTEMPTS = 4;
const API_RETRY_BASE_MS = 4_000;
const IMAGE_CONCURRENCY = Math.max(1, Math.min(2, Number(process.env.CMS_IMAGE_CONCURRENCY) || 1));
const WEBP_ONLY = /^(1|true|yes)$/i.test(process.env.CMS_WEBP_ONLY || "");
const IMAGE_FORMATS = WEBP_ONLY ? ["webp"] : ["avif", "webp"];
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
  return values
    .map((item) => {
      if (item == null) return null;
      if (typeof item === "string" || typeof item === "number") return String(item);
      if (item.id != null) return String(item.id);
      if (item.id_fields?.Id != null) return String(item.id_fields.Id);
      return null;
    })
    .filter(Boolean);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableApiFailure(status, detail) {
  if (status === 408 || status === 425 || status === 429 || status >= 500) return true;
  if (status !== 422) return false;
  return /57P03|recovery mode|ERR_DATABASE_OP_FAILED|database system is in recovery/i.test(detail);
}

async function fetchApiPage(url, config, label, pageNumber) {
  let lastError = null;

  for (let attempt = 1; attempt <= API_MAX_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        headers: { "xc-token": config.token },
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch (error) {
      lastError = error;
      if (attempt === API_MAX_ATTEMPTS) throw error;
      const delay = API_RETRY_BASE_MS * attempt;
      console.warn(
        `${label} page ${pageNumber} request error; ` +
        `retrying in ${Math.round(delay / 1000)}s (${attempt}/${API_MAX_ATTEMPTS})...`,
      );
      await sleep(delay);
      continue;
    }

    if (response.ok) return response;

    const detail = (await response.text()).slice(0, 500);
    if (!isRetryableApiFailure(response.status, detail) || attempt === API_MAX_ATTEMPTS) {
      throw new Error(
        `${label} request failed on page ${pageNumber}: ` +
        `${response.status} ${response.statusText}\n${detail}`,
      );
    }

    const delay = API_RETRY_BASE_MS * attempt;
    console.warn(
      `${label} page ${pageNumber} returned ${response.status}; ` +
      `retrying in ${Math.round(delay / 1000)}s (${attempt}/${API_MAX_ATTEMPTS})...`,
    );
    await sleep(delay);
  }

  throw lastError ?? new Error(`${label} request failed.`);
}

async function fetchTable(config, tableId, label) {
  const records = [];
  let pageNumber = 1;
  let next = `${config.url}/api/v3/data/${encodeURIComponent(config.baseId)}/` +
    `${encodeURIComponent(tableId)}/records?pageSize=${API_PAGE_SIZE}&linksAsLtar=true`;

  while (next) {
    const returnedUrl = new URL(next, `${config.url}/`);

    // NocoDB may return absolute pagination URLs using NC_SITE_URL. Preserve the
    // server-provided path/query but always use the configured origin, allowing
    // the VPS to use http://127.0.0.1:8080 without following the public hostname.
    const url = new URL(`${returnedUrl.pathname}${returnedUrl.search}`, `${config.url}/`);
    const response = await fetchApiPage(url, config, label, pageNumber);
    const page = await response.json();
    records.push(...(page.records ?? []));
    next = page.next ?? null;
    pageNumber += 1;
  }

  console.log(`Fetched ${records.length} ${label} record(s).`);
  return records;
}

function publicSourceSnapshot(tables) {
  const wanted = {
    collections: ["Name", "Slug", "Display Order", "Visible", "Collapsible", "Characters"],
    characters: ["Name", "Slug", "Subtitle", "Accent Color", "Display Order", "Visible", "Versions", "Collections", "Social 1 Label", "Social 1 URL"],
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
        if (["Characters", "Versions", "Collections", "Commissions", "Artists"].includes(name)) {
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
        collectionId: relationIds(record.fields?.Collections)[0] ?? null,
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
      imageTasks.set(taskKey, {
        key: taskKey,
        attachment,
        sourceUrl: new URL(attachment.signedPath, `${config.url}/`).href,
        fallbackUrl: thumbnailFallbackUrl(attachment, config.url),
      });
      version.referenceSheets.push({ taskKey });
    }
    delete version.referenceAttachments;
  }

  const galleries = new Map(versions.map((version) => [version.id, []]));
  for (const record of tables.commissions) {
    const fields = record.fields ?? {};
    if (fields.Published !== true) continue;

    const internalTitle = fields["Internal Title"];
    const label = `Commission ${record.id}${internalTitle ? ` (${internalTitle})` : ""}`;
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
      imageTasks.set(taskKey, {
        key: taskKey,
        attachment,
        sourceUrl: new URL(attachment.signedPath, `${config.url}/`).href,
        fallbackUrl: thumbnailFallbackUrl(attachment, config.url),
      });
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

function thumbnailFallbackUrl(attachment, baseUrl) {
  const thumbnails = attachment?.thumbnails ?? {};
  const signedPath = thumbnails.card_cover?.signedPath ||
    thumbnails.small?.signedPath ||
    thumbnails.tiny?.signedPath ||
    null;
  return signedPath ? new URL(signedPath, `${baseUrl}/`).href : null;
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
  let lastError = null;
  for (let attempt = 1; attempt <= IMAGE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(task.sourceUrl, {
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      });
      if (response.ok) return Buffer.from(await response.arrayBuffer());

      const detail = (await response.text()).slice(0, 300);
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === IMAGE_MAX_ATTEMPTS) {
        throw new Error(`Image ${task.key} failed: ${response.status} ${response.statusText}\n${detail}`);
      }
      const waitMs = IMAGE_RETRY_BASE_MS * attempt;
      console.warn(`Image ${task.key} returned ${response.status}; retrying in ${Math.round(waitMs / 1000)}s (${attempt}/${IMAGE_MAX_ATTEMPTS})...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    } catch (error) {
      lastError = error;
      if (attempt === IMAGE_MAX_ATTEMPTS) break;
      const waitMs = IMAGE_RETRY_BASE_MS * attempt;
      console.warn(`Image ${task.key} download failed (${error?.name || "error"}); retrying in ${Math.round(waitMs / 1000)}s (${attempt}/${IMAGE_MAX_ATTEMPTS})...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError ?? new Error(`Image ${task.key} failed after retries.`);
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
  return IMAGE_FORMATS.every((format) =>
    Array.isArray(entry.image.sources?.[format]) &&
    entry.image.sources[format].length > 0 &&
    entry.image.sources[format].every((source) => fileExists(source.url)),
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

  let processingBuffer = buffer;
  let usedThumbnailFallback = false;
  try {
    await sharp(processingBuffer, { animated: false }).metadata();
  } catch (error) {
    if (!task.fallbackUrl) {
      throw new Error(
        `${task.key} (${task.attachment?.title || "untitled"}, ${task.attachment?.mimetype || "unknown MIME"}) ` +
        `cannot be decoded by Sharp and has no NocoDB thumbnail fallback: ${error.message}`,
      );
    }
    console.warn(
      `Sharp cannot decode ${task.key} (${task.attachment?.title || "untitled"}, ${task.attachment?.mimetype || "unknown MIME"}); ` +
      "using NocoDB JPEG thumbnail fallback.",
    );
    processingBuffer = await downloadTask({
      ...task,
      key: `${task.key}:thumbnail-fallback`,
      sourceUrl: task.fallbackUrl,
    });
    try {
      await sharp(processingBuffer, { animated: false }).metadata();
    } catch (fallbackError) {
      throw new Error(
        `${task.key} fallback thumbnail is also unsupported: ${fallbackError.message}`,
      );
    }
    usedThumbnailFallback = true;
  }

  const derivativeHash = hash(processingBuffer);
  const stem = `${slugify(task.key, "image")}-${contentHash.slice(0, 12)}${usedThumbnailFallback ? `-fallback-${derivativeHash.slice(0, 8)}` : ""}`;
  const sources = { avif: [], webp: [] };
  for (const width of DERIVATIVE_WIDTHS) {
    for (const format of IMAGE_FORMATS) {
      const filename = `${stem}-${width}.${format}`;
      const output = path.join(IMAGE_DIR, filename);
      let info;
      if (fs.existsSync(output)) {
        info = await sharp(output).metadata();
      } else {
        const pipeline = sharp(processingBuffer, { animated: false }).rotate().resize({ width, withoutEnlargement: true });
        info = format === "avif"
          ? await pipeline.avif({ quality: 65, effort: 3 }).toFile(output)
          : await pipeline.webp({ quality: 80, effort: 4 }).toFile(output);
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
  if (!fallback) throw new Error(`${task.key} produced no WebP fallback output.`);
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
  return { signature, contentHash, usedThumbnailFallback, image };
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
  console.log("Fetching Collections, Characters, Versions, Commissions, and Artists sequentially...");
  const collections = await fetchTable(config, config.collections, "Collections");
  const characters = await fetchTable(config, config.characters, "Characters");
  const versions = await fetchTable(config, config.versions, "Versions");
  const commissions = await fetchTable(config, config.commissions, "Commissions");
  const artists = await fetchTable(config, config.artists, "Artists");
  const tables = { collections, characters, versions, commissions, artists };
  const sourceFingerprint = fingerprint(publicSourceSnapshot(tables));
  const previous = readJson(MANIFEST_FILE, { attachments: {} });
  const model = createModel(tables, config);
  const publishedCommissionCount = commissions.filter((record) => record.fields?.Published === true).length;
  console.log(
    `Public model: ${model.collections.length} collection(s), ` +
    `${model.collections.flatMap((collection) => collection.characters).length} character(s), ` +
    `${model.versions.length} version(s), ${publishedCommissionCount} published commission record(s).`,
  );
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
  console.log(`Processing ${tasks.length} image task(s) with concurrency ${IMAGE_CONCURRENCY}${WEBP_ONLY ? " (WebP-only mode)" : ""}...`);
  let completed = 0;
  const imageFailures = [];
  const entries = await mapWithConcurrency(tasks, IMAGE_CONCURRENCY, async (task) => {
    const sequence = completed + 1;
    console.log(
      `Image ${sequence}/${tasks.length}: ${task.key} | ${task.attachment?.title || "untitled"} | ` +
      `${task.attachment?.mimetype || "unknown MIME"} | ${task.attachment?.size ?? "unknown size"} bytes`,
    );
    const oldEntry = previous.attachments?.[task.key];
    try {
      const entry = await processImage(task, oldEntry);
      if (entry !== oldEntry) processed += 1;
      return [task.key, entry];
    } catch (error) {
      imageFailures.push({ key: task.key, message: error.message });
      console.error(`Image failed: ${task.key}: ${error.message}`);
      return null;
    } finally {
      completed += 1;
    }
  });
  if (imageFailures.length) {
    console.error(`Image processing completed with ${imageFailures.length} failure(s):`);
    for (const failure of imageFailures) console.error(`- ${failure.key}: ${failure.message}`);
    throw new Error("One or more image tasks failed; generated CMS output was not published.");
  }
  const attachmentEntries = Object.fromEntries(entries.filter(Boolean));
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
