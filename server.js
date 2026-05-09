const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const port = process.env.PORT || 3000;
const root = __dirname;
const storageDir = process.env.STORAGE_DIR || root;
const dataDir = path.join(storageDir, "data");
const uploadsDir = path.join(storageDir, "uploads");
const memoriesFile = path.join(dataDir, "memories.json");
const schedulesFile = path.join(dataDir, "schedules.json");
const repoDataDir = path.join(root, "data");
const repoUploadsDir = path.join(root, "uploads");
const githubToken = process.env.GITHUB_TOKEN || "";
const githubRepo = process.env.GITHUB_REPO || "";
const githubBranch = process.env.GITHUB_BRANCH || "main";
const githubCommitName = process.env.GITHUB_COMMIT_NAME || "Alexia Timeline";
const githubCommitEmail = process.env.GITHUB_COMMIT_EMAIL || "timeline@render.com";
const databaseUrl = process.env.DATABASE_URL || "";
const cloudinaryCloudName = process.env.CLOUDINARY_CLOUD_NAME || "";
const cloudinaryApiKey = process.env.CLOUDINARY_API_KEY || "";
const cloudinaryApiSecret = process.env.CLOUDINARY_API_SECRET || "";
const sitePassword = process.env.SITE_PASSWORD || "";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp"
};

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

function isEmptyJsonArray(filePath) {
  if (!fs.existsSync(filePath)) {
    return true;
  }

  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(value) && value.length === 0;
  } catch {
    return false;
  }
}

function seedFileFromRepo(repoFile, storageFile, shouldReplaceEmptyArray = false) {
  if (!fs.existsSync(repoFile)) {
    return;
  }

  const shouldCopy = !fs.existsSync(storageFile) || (shouldReplaceEmptyArray && isEmptyJsonArray(storageFile));

  if (shouldCopy) {
    fs.copyFileSync(repoFile, storageFile);
  }
}

function mergeArrayById(existingItems, repoItems) {
  const merged = [...existingItems];
  const existingIds = new Set(existingItems.map((item) => item.id).filter(Boolean));

  repoItems.forEach((item) => {
    if (!item.id || existingIds.has(item.id)) {
      return;
    }

    merged.push(item);
    existingIds.add(item.id);
  });

  return merged;
}

function seedMemoriesFromRepo() {
  const repoFile = path.join(repoDataDir, "memories.json");

  if (!fs.existsSync(repoFile)) {
    return;
  }

  if (!fs.existsSync(memoriesFile) || isEmptyJsonArray(memoriesFile)) {
    fs.copyFileSync(repoFile, memoriesFile);
    return;
  }

  const storageMemories = JSON.parse(fs.readFileSync(memoriesFile, "utf8"));
  const repoMemories = JSON.parse(fs.readFileSync(repoFile, "utf8"));
  const mergedMemories = mergeArrayById(storageMemories, repoMemories).sort((a, b) => {
    const firstDate = b.startDate || b.date || "";
    const secondDate = a.startDate || a.date || "";
    return firstDate.localeCompare(secondDate);
  });

  if (mergedMemories.length !== storageMemories.length) {
    fs.writeFileSync(memoriesFile, JSON.stringify(mergedMemories, null, 2));
  }
}

function seedSchedulesFromRepo() {
  const repoFile = path.join(repoDataDir, "schedules.json");

  if (!fs.existsSync(repoFile)) {
    return;
  }

  if (!fs.existsSync(schedulesFile)) {
    fs.copyFileSync(repoFile, schedulesFile);
    return;
  }

  const storageSchedules = JSON.parse(fs.readFileSync(schedulesFile, "utf8"));
  const repoSchedules = JSON.parse(fs.readFileSync(repoFile, "utf8"));
  const mergedSchedules = {
    events: mergeArrayById(storageSchedules.events || [], repoSchedules.events || []),
    images: mergeArrayById(storageSchedules.images || [], repoSchedules.images || [])
  };

  if (
    mergedSchedules.events.length !== (storageSchedules.events || []).length ||
    mergedSchedules.images.length !== (storageSchedules.images || []).length
  ) {
    fs.writeFileSync(schedulesFile, JSON.stringify(mergedSchedules, null, 2));
  }
}

function seedUploadsFromRepo() {
  if (path.resolve(repoUploadsDir) === path.resolve(uploadsDir) || !fs.existsSync(repoUploadsDir)) {
    return;
  }

  fs.readdirSync(repoUploadsDir, { withFileTypes: true }).forEach((entry) => {
    if (!entry.isFile()) {
      return;
    }

    const sourcePath = path.join(repoUploadsDir, entry.name);
    const destinationPath = path.join(uploadsDir, entry.name);

    if (!fs.existsSync(destinationPath)) {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  });
}

if (path.resolve(storageDir) !== path.resolve(root)) {
  seedMemoriesFromRepo();
  seedSchedulesFromRepo();
  seedUploadsFromRepo();
}

if (!fs.existsSync(memoriesFile)) {
  fs.writeFileSync(memoriesFile, "[]");
}

if (!fs.existsSync(schedulesFile)) {
  fs.writeFileSync(schedulesFile, JSON.stringify({ events: [], images: [] }, null, 2));
}

function isGithubSyncEnabled() {
  return Boolean(githubToken && githubRepo);
}

function encodeGitHubPath(repoPath) {
  return repoPath.split("/").map(encodeURIComponent).join("/");
}

function githubRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : "";
    const request = https.request({
      hostname: "api.github.com",
      path: apiPath,
      method,
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + githubToken,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "User-Agent": "alexia-timeline",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    }, (response) => {
      const chunks = [];

      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const data = text ? JSON.parse(text) : {};
        resolve({ statusCode: response.statusCode, data });
      });
    });

    request.on("error", reject);
    request.end(payload);
  });
}

function downloadUrlToFile(fileUrl, localPath) {
  return new Promise((resolve, reject) => {
    const request = https.get(fileUrl, {
      headers: {
        "Authorization": "Bearer " + githubToken,
        "User-Agent": "alexia-timeline"
      }
    }, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error("GitHub could not download an image."));
        return;
      }

      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      const file = fs.createWriteStream(localPath);
      response.pipe(file);
      file.on("finish", () => {
        file.close(resolve);
      });
      file.on("error", reject);
    });

    request.on("error", reject);
  });
}

async function getGithubFileSha(repoPath) {
  const encodedPath = encodeGitHubPath(repoPath);
  const response = await githubRequest("GET", "/repos/" + githubRepo + "/contents/" + encodedPath + "?ref=" + encodeURIComponent(githubBranch));

  if (response.statusCode === 404) {
    return "";
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error("GitHub could not read " + repoPath + ".");
  }

  return response.data.sha || "";
}

async function syncFileToGithub(localPath, repoPath, message) {
  const sha = await getGithubFileSha(repoPath);
  const encodedPath = encodeGitHubPath(repoPath);
  const payload = {
    message,
    content: fs.readFileSync(localPath).toString("base64"),
    branch: githubBranch,
    committer: {
      name: githubCommitName,
      email: githubCommitEmail
    }
  };

  if (sha) {
    payload.sha = sha;
  }

  const response = await githubRequest("PUT", "/repos/" + githubRepo + "/contents/" + encodedPath, payload);

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const details = response.data && response.data.message ? " " + response.data.message : "";
    throw new Error("GitHub could not save " + repoPath + "." + details);
  }
}

async function deleteFileFromGithub(repoPath, message) {
  const sha = await getGithubFileSha(repoPath);

  if (!sha) {
    return;
  }

  const encodedPath = encodeGitHubPath(repoPath);
  const response = await githubRequest("DELETE", "/repos/" + githubRepo + "/contents/" + encodedPath, {
    message,
    sha,
    branch: githubBranch,
    committer: {
      name: githubCommitName,
      email: githubCommitEmail
    }
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const details = response.data && response.data.message ? " " + response.data.message : "";
    throw new Error("GitHub could not delete " + repoPath + "." + details);
  }
}

let githubSyncQueue = Promise.resolve();

function queueGithubSync(task, waitForGithub = false) {
  if (!isGithubSyncEnabled()) {
    return Promise.resolve();
  }

  const syncTask = githubSyncQueue.then(task);

  githubSyncQueue = syncTask.catch((error) => {
    console.error("GitHub sync failed:", error.message);
  });

  return waitForGithub ? syncTask : githubSyncQueue;
}

function queueGithubFileSync(localPath, repoPath, message, waitForGithub = false) {
  return queueGithubSync(() => syncFileToGithub(localPath, repoPath, message), waitForGithub);
}

function queueGithubFileDelete(repoPath, message, waitForGithub = false) {
  return queueGithubSync(() => deleteFileFromGithub(repoPath, message), waitForGithub);
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function readGithubJsonFile(repoPath) {
  if (!isGithubSyncEnabled()) {
    return null;
  }

  const encodedPath = encodeGitHubPath(repoPath);
  const response = await githubRequest("GET", "/repos/" + githubRepo + "/contents/" + encodedPath + "?ref=" + encodeURIComponent(githubBranch));

  if (response.statusCode === 404) {
    return null;
  }

  if (response.statusCode < 200 || response.statusCode >= 300 || !response.data.content) {
    throw new Error("GitHub could not read " + repoPath + ".");
  }

  const text = Buffer.from(response.data.content.replace(/\s/g, ""), "base64").toString("utf8");
  return JSON.parse(text);
}

async function downloadGithubFile(repoPath, localPath, downloadUrl = "") {
  if (downloadUrl) {
    await downloadUrlToFile(downloadUrl, localPath);
    return true;
  }

  const encodedPath = encodeGitHubPath(repoPath);
  const response = await githubRequest("GET", "/repos/" + githubRepo + "/contents/" + encodedPath + "?ref=" + encodeURIComponent(githubBranch));

  if (response.statusCode === 404) {
    return false;
  }

  if (response.data.download_url) {
    await downloadUrlToFile(response.data.download_url, localPath);
    return true;
  }

  if (response.statusCode < 200 || response.statusCode >= 300 || !response.data.content) {
    throw new Error("GitHub could not download " + repoPath + ".");
  }

  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, Buffer.from(response.data.content.replace(/\s/g, ""), "base64"));
  return true;
}

function writeMergedMemories(githubMemories) {
  if (!Array.isArray(githubMemories)) {
    return;
  }

  const storageMemories = readJsonFile(memoriesFile, []);
  const mergedMemories = mergeArrayById(storageMemories, githubMemories).sort((a, b) => {
    const firstDate = b.startDate || b.date || "";
    const secondDate = a.startDate || a.date || "";
    return firstDate.localeCompare(secondDate);
  });

  if (mergedMemories.length !== storageMemories.length || !fs.existsSync(memoriesFile)) {
    fs.writeFileSync(memoriesFile, JSON.stringify(mergedMemories, null, 2));
  }
}

function writeMergedSchedules(githubSchedules) {
  if (!githubSchedules) {
    return;
  }

  const storageSchedules = readJsonFile(schedulesFile, { events: [], images: [] });
  const mergedSchedules = {
    events: mergeArrayById(storageSchedules.events || [], githubSchedules.events || []),
    images: mergeArrayById(storageSchedules.images || [], githubSchedules.images || [])
  };

  if (
    mergedSchedules.events.length !== (storageSchedules.events || []).length ||
    mergedSchedules.images.length !== (storageSchedules.images || []).length ||
    !fs.existsSync(schedulesFile)
  ) {
    fs.writeFileSync(schedulesFile, JSON.stringify(mergedSchedules, null, 2));
  }
}

async function importGithubUploads() {
  const response = await githubRequest("GET", "/repos/" + githubRepo + "/contents/uploads?ref=" + encodeURIComponent(githubBranch));

  if (response.statusCode === 404) {
    return;
  }

  if (response.statusCode < 200 || response.statusCode >= 300 || !Array.isArray(response.data)) {
    throw new Error("GitHub could not list uploads.");
  }

  for (const item of response.data) {
    const extension = path.extname(item.name || "").toLowerCase();

    if (item.type !== "file" || ![".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(extension)) {
      continue;
    }

    const localPath = path.join(uploadsDir, item.name);

    if (!fs.existsSync(localPath) || fs.statSync(localPath).size === 0) {
      await downloadGithubFile("uploads/" + item.name, localPath, item.download_url);
    }
  }
}

async function importFromGithubAtStartup() {
  if (isDatabaseStorageEnabled() || !isGithubSyncEnabled()) {
    return;
  }

  try {
    writeMergedMemories(await readGithubJsonFile("data/memories.json"));
    writeMergedSchedules(await readGithubJsonFile("data/schedules.json"));
    await importGithubUploads();
  } catch (error) {
    console.error("GitHub startup import failed:", error.message);
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function isWriteRequest(request, pathname) {
  if (request.method === "GET") {
    return false;
  }

  return pathname.startsWith("/api/");
}

function isAuthorized(request) {
  if (!sitePassword) {
    return true;
  }

  return request.headers["x-site-password"] === sitePassword;
}

function githubSyncStatus() {
  return {
    enabled: isGithubSyncEnabled(),
    repo: githubRepo || "",
    branch: githubBranch || "",
    hasToken: Boolean(githubToken)
  };
}

function readMemories() {
  return JSON.parse(fs.readFileSync(memoriesFile, "utf8"));
}

function saveMemories(memories) {
  fs.writeFileSync(memoriesFile, JSON.stringify(memories, null, 2));
  queueGithubFileSync(memoriesFile, "data/memories.json", "Update memories");
}

function readSchedules() {
  return JSON.parse(fs.readFileSync(schedulesFile, "utf8"));
}

function saveSchedules(schedules) {
  fs.writeFileSync(schedulesFile, JSON.stringify(schedules, null, 2));
  queueGithubFileSync(schedulesFile, "data/schedules.json", "Update schedules");
}

async function saveSchedulesAndSync(schedules) {
  fs.writeFileSync(schedulesFile, JSON.stringify(schedules, null, 2));
  await queueGithubFileSync(schedulesFile, "data/schedules.json", "Update schedules", true);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function parseMultipart(body, boundary) {
  const parts = [];
  const boundaryText = "--" + boundary;
  const bodyText = body.toString("latin1");
  const sections = bodyText.split(boundaryText).slice(1, -1);

  for (const section of sections) {
    const trimmed = section.replace(/^\r\n/, "");
    const separator = trimmed.indexOf("\r\n\r\n");

    if (separator === -1) {
      continue;
    }

    const rawHeaders = trimmed.slice(0, separator);
    let content = trimmed.slice(separator + 4);

    if (content.endsWith("\r\n")) {
      content = content.slice(0, -2);
    }

    const disposition = rawHeaders.match(/Content-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]*)")?/i);
    const type = rawHeaders.match(/Content-Type: ([^\r\n]+)/i);

    if (!disposition) {
      continue;
    }

    parts.push({
      name: disposition[1],
      filename: disposition[2],
      contentType: type ? type[1] : "text/plain",
      data: Buffer.from(content, "latin1")
    });
  }

  return parts;
}

function safeUploadExtension(contentType, filename) {
  const fromType = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp"
  }[contentType.toLowerCase()];

  if (fromType) {
    return fromType;
  }

  const fromName = path.extname(filename || "").toLowerCase();
  return [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(fromName) ? fromName : ".jpg";
}

function isDatabaseStorageEnabled() {
  return Boolean(databaseUrl && cloudinaryCloudName && cloudinaryApiKey && cloudinaryApiSecret);
}

let dbPool = null;
let cloudinaryClient = null;

function getDbPool() {
  if (!dbPool) {
    const { Pool } = require("pg");
    dbPool = new Pool({
      connectionString: databaseUrl,
      ssl: {
        rejectUnauthorized: false
      }
    });
  }

  return dbPool;
}

function getCloudinary() {
  if (!cloudinaryClient) {
    cloudinaryClient = require("cloudinary").v2;
    cloudinaryClient.config({
      cloud_name: cloudinaryCloudName,
      api_key: cloudinaryApiKey,
      api_secret: cloudinaryApiSecret
    });
  }

  return cloudinaryClient;
}

function uploadImageToCloudinary(file, folder) {
  return new Promise((resolve, reject) => {
    const upload = getCloudinary().uploader.upload_stream({
      folder,
      resource_type: "image"
    }, (error, result) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        imageUrl: result.secure_url,
        publicId: result.public_id
      });
    });

    upload.end(file.data);
  });
}

async function deleteCloudinaryImage(publicId) {
  if (!publicId) {
    return;
  }

  await getCloudinary().uploader.destroy(publicId, {
    resource_type: "image"
  });
}

function dbTripRowToMemory(trip, photos) {
  const tripPhotos = photos.filter((photo) => photo.trip_id === trip.id);
  const photoUrls = tripPhotos.map((photo) => photo.image_url);
  const coverPhoto = tripPhotos.find((photo) => photo.id === trip.cover_photo_id) || tripPhotos[0];

  return {
    id: trip.id,
    date: trip.start_date,
    startDate: trip.start_date,
    endDate: trip.end_date || "",
    title: trip.title,
    note: trip.note,
    photos: photoUrls,
    coverPhoto: coverPhoto ? coverPhoto.image_url : "",
    createdAt: trip.created_at
  };
}

async function getMemoriesFromDatabase() {
  const pool = getDbPool();
  const [tripsResult, photosResult] = await Promise.all([
    pool.query("select id, title, note, start_date::text, end_date::text, cover_photo_id, created_at from trips order by start_date desc"),
    pool.query("select id, trip_id, image_url, cloudinary_public_id, created_at from trip_photos order by created_at")
  ]);

  return tripsResult.rows.map((trip) => dbTripRowToMemory(trip, photosResult.rows));
}

async function createMemoryInDatabase(fields, uploadedPhotos) {
  const uploads = [];
  const client = await getDbPool().connect();

  try {
    for (const photo of uploadedPhotos) {
      uploads.push(await uploadImageToCloudinary(photo, "alexia/trips"));
    }

    await client.query("begin");
    const tripResult = await client.query(
      "insert into trips (title, note, start_date, end_date) values ($1, $2, $3, $4) returning id, title, note, start_date::text, end_date::text, cover_photo_id, created_at",
      [fields.title, fields.note, fields.startDate, fields.endDate || null]
    );
    const trip = tripResult.rows[0];
    const photoRows = [];

    for (const upload of uploads) {
      const photoResult = await client.query(
        "insert into trip_photos (trip_id, image_url, cloudinary_public_id) values ($1, $2, $3) returning id, trip_id, image_url, cloudinary_public_id, created_at",
        [trip.id, upload.imageUrl, upload.publicId]
      );
      photoRows.push(photoResult.rows[0]);
    }

    await client.query("update trips set cover_photo_id = $1 where id = $2", [photoRows[0].id, trip.id]);
    await client.query("commit");
    trip.cover_photo_id = photoRows[0].id;
    return dbTripRowToMemory(trip, photoRows);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    await Promise.all(uploads.map((upload) => deleteCloudinaryImage(upload.publicId).catch(() => {})));
    throw error;
  } finally {
    client.release();
  }
}

async function addMemoryPhotosInDatabase(id, photos) {
  const uploads = [];
  const client = await getDbPool().connect();

  try {
    const tripCheck = await client.query("select id, cover_photo_id from trips where id = $1", [id]);

    if (tripCheck.rowCount === 0) {
      return null;
    }

    for (const photo of photos) {
      uploads.push(await uploadImageToCloudinary(photo, "alexia/trips"));
    }

    await client.query("begin");
    const newPhotos = [];

    for (const upload of uploads) {
      const photoResult = await client.query(
        "insert into trip_photos (trip_id, image_url, cloudinary_public_id) values ($1, $2, $3) returning id",
        [id, upload.imageUrl, upload.publicId]
      );
      newPhotos.push(photoResult.rows[0]);
    }

    if (!tripCheck.rows[0].cover_photo_id && newPhotos.length > 0) {
      await client.query("update trips set cover_photo_id = $1 where id = $2", [newPhotos[0].id, id]);
    }

    await client.query("commit");
    return (await getMemoriesFromDatabase()).find((trip) => trip.id === id);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    await Promise.all(uploads.map((upload) => deleteCloudinaryImage(upload.publicId).catch(() => {})));
    throw error;
  } finally {
    client.release();
  }
}

async function deleteMemoryFromDatabase(id) {
  const client = await getDbPool().connect();

  try {
    const photosResult = await client.query("select cloudinary_public_id from trip_photos where trip_id = $1", [id]);
    await client.query("update trips set cover_photo_id = null where id = $1", [id]);
    const tripResult = await client.query("delete from trips where id = $1 returning id", [id]);

    if (tripResult.rowCount === 0) {
      return false;
    }

    await Promise.all(photosResult.rows.map((photo) => deleteCloudinaryImage(photo.cloudinary_public_id).catch(() => {})));
    return true;
  } finally {
    client.release();
  }
}

async function deleteMemoryPhotosFromDatabase(id, photosToDelete) {
  const client = await getDbPool().connect();

  try {
    await client.query("begin");
    const allPhotos = (await client.query(
      "select id, image_url, cloudinary_public_id from trip_photos where trip_id = $1 order by created_at",
      [id]
    )).rows;

    if (allPhotos.length === 0) {
      await client.query("rollback");
      return { status: 404 };
    }

    const selected = allPhotos.filter((photo) => photosToDelete.includes(photo.image_url));

    if (selected.length !== photosToDelete.length) {
      await client.query("rollback");
      return { status: 400, error: "One of those photos does not belong to this trip." };
    }

    const remaining = allPhotos.filter((photo) => !photosToDelete.includes(photo.image_url));

    if (remaining.length === 0) {
      await client.query("rollback");
      return { status: 400, error: "A trip needs at least one picture. Delete the trip instead." };
    }

    const trip = (await client.query("select cover_photo_id from trips where id = $1", [id])).rows[0];

    if (trip && selected.some((photo) => photo.id === trip.cover_photo_id)) {
      await client.query("update trips set cover_photo_id = $1 where id = $2", [remaining[0].id, id]);
    }

    await client.query("delete from trip_photos where trip_id = $1 and image_url = any($2)", [id, photosToDelete]);
    await client.query("commit");
    await Promise.all(selected.map((photo) => deleteCloudinaryImage(photo.cloudinary_public_id).catch(() => {})));
    return { status: 200, memory: (await getMemoriesFromDatabase()).find((trip) => trip.id === id) };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function updateCoverPhotoInDatabase(id, coverPhoto) {
  const photo = await getDbPool().query("select id from trip_photos where trip_id = $1 and image_url = $2", [id, coverPhoto]);

  if (photo.rowCount === 0) {
    return null;
  }

  await getDbPool().query("update trips set cover_photo_id = $1 where id = $2", [photo.rows[0].id, id]);
  return (await getMemoriesFromDatabase()).find((trip) => trip.id === id);
}

async function getSchedulesFromDatabase() {
  const pool = getDbPool();
  const [eventsResult, imagesResult] = await Promise.all([
    pool.query("select id, person, day, title, start_time::text, end_time::text, note, created_at from schedule_events order by day, start_time"),
    pool.query("select id, person, image_url, cloudinary_public_id, created_at from schedule_images order by created_at")
  ]);

  return {
    events: eventsResult.rows.map((event) => ({
      id: event.id,
      person: event.person,
      day: event.day,
      title: event.title,
      startTime: event.start_time.slice(0, 5),
      endTime: event.end_time.slice(0, 5),
      note: event.note || "",
      createdAt: event.created_at
    })),
    images: imagesResult.rows.map((image) => ({
      id: image.id,
      person: image.person,
      image: image.image_url,
      createdAt: image.created_at
    }))
  };
}

async function createScheduleEventInDatabase(event) {
  const result = await getDbPool().query(
    "insert into schedule_events (person, day, title, start_time, end_time, note) values ($1, $2, $3, $4, $5, $6) returning id, person, day, title, start_time::text, end_time::text, note, created_at",
    [event.person, event.day, event.title, event.startTime, event.endTime, event.note || ""]
  );
  const savedEvent = result.rows[0];

  return {
    id: savedEvent.id,
    person: savedEvent.person,
    day: savedEvent.day,
    title: savedEvent.title,
    startTime: savedEvent.start_time.slice(0, 5),
    endTime: savedEvent.end_time.slice(0, 5),
    note: savedEvent.note || "",
    createdAt: savedEvent.created_at
  };
}

async function deleteScheduleEventFromDatabase(id) {
  await getDbPool().query("delete from schedule_events where id = $1", [id]);
}

async function uploadScheduleImageToDatabase(person, image) {
  const upload = await uploadImageToCloudinary(image, "alexia/schedules");

  try {
    const result = await getDbPool().query(
      "insert into schedule_images (person, image_url, cloudinary_public_id) values ($1, $2, $3) returning id, person, image_url, created_at",
      [person, upload.imageUrl, upload.publicId]
    );
    const savedImage = result.rows[0];

    return {
      id: savedImage.id,
      person: savedImage.person,
      image: savedImage.image_url,
      createdAt: savedImage.created_at
    };
  } catch (error) {
    await deleteCloudinaryImage(upload.publicId).catch(() => {});
    throw error;
  }
}

async function deleteScheduleImageFromDatabase(id) {
  const result = await getDbPool().query("delete from schedule_images where id = $1 returning cloudinary_public_id", [id]);

  if (result.rowCount > 0) {
    await deleteCloudinaryImage(result.rows[0].cloudinary_public_id).catch(() => {});
  }
}

function normalizeMemory(memory) {
  if (memory.photos) {
    return memory;
  }

  return {
    ...memory,
    startDate: memory.startDate || memory.date,
    endDate: memory.endDate || "",
    photos: memory.photo ? [memory.photo] : [],
    coverPhoto: memory.coverPhoto || memory.photo || ""
  };
}

function saveUploadedPhotos(photos) {
  return photos.map((photo) => {
    const extension = safeUploadExtension(photo.contentType, photo.filename);
    const uploadName = crypto.randomUUID() + extension;
    const uploadPath = path.join(uploadsDir, uploadName);
    fs.writeFileSync(uploadPath, photo.data);
    queueGithubFileSync(uploadPath, "uploads/" + uploadName, "Add uploaded photo");
    return "/uploads/" + uploadName;
  });
}

function deleteUploadedFile(filePath) {
  if (!filePath || !filePath.startsWith("/uploads/")) {
    return;
  }

  const uploadPath = path.normalize(path.join(storageDir, filePath));

  if (uploadPath.startsWith(uploadsDir) && fs.existsSync(uploadPath)) {
    fs.unlinkSync(uploadPath);
    queueGithubFileDelete("uploads/" + path.basename(filePath), "Delete uploaded photo");
  }
}

async function handleCreateMemory(request, response) {
  const contentType = request.headers["content-type"] || "";
  const boundary = contentType.match(/boundary=(.+)$/);

  if (!boundary) {
    sendJson(response, 400, { error: "Missing upload boundary." });
    return;
  }

  const body = await readBody(request);
  const parts = parseMultipart(body, boundary[1]);
  const fields = Object.fromEntries(parts.filter((part) => !part.filename).map((part) => [part.name, part.data.toString("utf8")]));
  const photos = parts.filter((part) => part.name === "photos" && part.filename && part.data.length > 0);
  const legacyPhoto = parts.find((part) => part.name === "photo" && part.filename && part.data.length > 0);
  const uploadedPhotos = photos.length > 0 ? photos : legacyPhoto ? [legacyPhoto] : [];

  if (!fields.startDate || !fields.title || !fields.note || uploadedPhotos.length === 0) {
    sendJson(response, 400, { error: "Start date, title, memory, and at least one picture are required." });
    return;
  }

  if (uploadedPhotos.some((photo) => !photo.contentType.startsWith("image/"))) {
    sendJson(response, 400, { error: "The upload must be an image." });
    return;
  }

  if (isDatabaseStorageEnabled()) {
    sendJson(response, 201, await createMemoryInDatabase(fields, uploadedPhotos));
    return;
  }

  const savedPhotos = saveUploadedPhotos(uploadedPhotos);

  const memory = {
    id: crypto.randomUUID(),
    date: fields.startDate,
    startDate: fields.startDate,
    endDate: fields.endDate || "",
    title: fields.title,
    note: fields.note,
    photos: savedPhotos,
    coverPhoto: savedPhotos[0],
    createdAt: new Date().toISOString()
  };

  const memories = readMemories().map(normalizeMemory);
  memories.push(memory);
  memories.sort((a, b) => b.startDate.localeCompare(a.startDate));
  saveMemories(memories);
  sendJson(response, 201, memory);
}

async function handleAddMemoryPhotos(request, response, id) {
  const contentType = request.headers["content-type"] || "";
  const boundary = contentType.match(/boundary=(.+)$/);

  if (!boundary) {
    sendJson(response, 400, { error: "Missing upload boundary." });
    return;
  }

  const body = await readBody(request);
  const parts = parseMultipart(body, boundary[1]);
  const photos = parts.filter((part) => part.name === "photos" && part.filename && part.data.length > 0);

  if (photos.length === 0) {
    sendJson(response, 400, { error: "Choose at least one picture." });
    return;
  }

  if (photos.some((photo) => !photo.contentType.startsWith("image/"))) {
    sendJson(response, 400, { error: "The upload must be an image." });
    return;
  }

  if (isDatabaseStorageEnabled()) {
    const updatedMemory = await addMemoryPhotosInDatabase(id, photos);

    if (!updatedMemory) {
      sendJson(response, 404, { error: "Trip not found." });
      return;
    }

    sendJson(response, 201, updatedMemory);
    return;
  }

  const savedPhotos = saveUploadedPhotos(photos);
  const memories = readMemories().map(normalizeMemory);
  const memory = memories.find((item) => item.id === id);

  if (!memory) {
    sendJson(response, 404, { error: "Trip not found." });
    return;
  }

  memory.photos.push(...savedPhotos);

  if (!memory.coverPhoto) {
    memory.coverPhoto = memory.photos[0];
  }

  saveMemories(memories);
  sendJson(response, 201, memory);
}

async function handleDeleteMemory(request, response, id) {
  if (isDatabaseStorageEnabled()) {
    const deleted = await deleteMemoryFromDatabase(id);

    if (!deleted) {
      sendJson(response, 404, { error: "Memory not found." });
      return;
    }

    sendJson(response, 200, { ok: true });
    return;
  }

  const memories = readMemories().map(normalizeMemory);
  const memory = memories.find((item) => item.id === id);
  const remaining = memories.filter((item) => item.id !== id);

  if (!memory) {
    sendJson(response, 404, { error: "Memory not found." });
    return;
  }

  saveMemories(remaining);

  memory.photos.forEach((photo) => {
    deleteUploadedFile(photo);
  });

  sendJson(response, 200, { ok: true });
}

async function handleDeleteMemoryPhoto(request, response, id) {
  const body = await readBody(request);
  const payload = JSON.parse(body.toString("utf8") || "{}");
  const photosToDelete = Array.isArray(payload.photos) ? payload.photos : payload.photo ? [payload.photo] : [];
  const uniquePhotosToDelete = [...new Set(photosToDelete)];

  if (isDatabaseStorageEnabled()) {
    if (uniquePhotosToDelete.length === 0) {
      sendJson(response, 400, { error: "Choose at least one picture to delete." });
      return;
    }

    const result = await deleteMemoryPhotosFromDatabase(id, uniquePhotosToDelete);

    if (result.status === 404) {
      sendJson(response, 404, { error: "Trip not found." });
      return;
    }

    if (result.status !== 200) {
      sendJson(response, result.status, { error: result.error });
      return;
    }

    sendJson(response, 200, result.memory);
    return;
  }

  const memories = readMemories().map(normalizeMemory);
  const memory = memories.find((item) => item.id === id);

  if (!memory) {
    sendJson(response, 404, { error: "Trip not found." });
    return;
  }

  if (uniquePhotosToDelete.length === 0) {
    sendJson(response, 400, { error: "Choose at least one picture to delete." });
    return;
  }

  if (uniquePhotosToDelete.some((photo) => !memory.photos.includes(photo))) {
    sendJson(response, 400, { error: "One of those photos does not belong to this trip." });
    return;
  }

  const remainingPhotos = memory.photos.filter((photo) => !uniquePhotosToDelete.includes(photo));

  if (remainingPhotos.length === 0) {
    sendJson(response, 400, { error: "A trip needs at least one picture. Delete the trip instead." });
    return;
  }

  memory.photos = remainingPhotos;

  if (uniquePhotosToDelete.includes(memory.coverPhoto)) {
    memory.coverPhoto = memory.photos[0];
  }

  saveMemories(memories);
  uniquePhotosToDelete.forEach(deleteUploadedFile);
  sendJson(response, 200, memory);
}

async function handleUpdateCoverPhoto(request, response, id) {
  const body = await readBody(request);
  const payload = JSON.parse(body.toString("utf8") || "{}");

  if (isDatabaseStorageEnabled()) {
    const updatedMemory = await updateCoverPhotoInDatabase(id, payload.coverPhoto);

    if (!updatedMemory) {
      sendJson(response, 400, { error: "That photo does not belong to this trip." });
      return;
    }

    sendJson(response, 200, updatedMemory);
    return;
  }

  const memories = readMemories().map(normalizeMemory);
  const memory = memories.find((item) => item.id === id);

  if (!memory) {
    sendJson(response, 404, { error: "Trip not found." });
    return;
  }

  if (!memory.photos.includes(payload.coverPhoto)) {
    sendJson(response, 400, { error: "That photo does not belong to this trip." });
    return;
  }

  memory.coverPhoto = payload.coverPhoto;
  saveMemories(memories);
  sendJson(response, 200, memory);
}

async function handleCreateScheduleEvent(request, response) {
  const body = await readBody(request);
  const event = JSON.parse(body.toString("utf8") || "{}");
  const allowedDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const allowedPeople = ["Jaxon", "Alexia"];

  if (!allowedPeople.includes(event.person) || !allowedDays.includes(event.day) || !event.title || !event.startTime || !event.endTime) {
    sendJson(response, 400, { error: "Person, day, title, start time, and end time are required." });
    return;
  }

  const savedEvent = {
    id: crypto.randomUUID(),
    person: event.person,
    day: event.day,
    title: event.title,
    startTime: event.startTime,
    endTime: event.endTime,
    note: event.note || "",
    createdAt: new Date().toISOString()
  };

  if (isDatabaseStorageEnabled()) {
    sendJson(response, 201, await createScheduleEventInDatabase(event));
    return;
  }

  const schedules = readSchedules();

  schedules.events.push(savedEvent);
  schedules.events.sort((a, b) => a.day.localeCompare(b.day) || a.startTime.localeCompare(b.startTime));
  await saveSchedulesAndSync(schedules);
  sendJson(response, 201, savedEvent);
}

async function handleDeleteScheduleEvent(response, id) {
  if (isDatabaseStorageEnabled()) {
    await deleteScheduleEventFromDatabase(id);
    sendJson(response, 200, { ok: true });
    return;
  }

  const schedules = readSchedules();
  schedules.events = schedules.events.filter((event) => event.id !== id);
  await saveSchedulesAndSync(schedules);
  sendJson(response, 200, { ok: true });
}

async function handleUploadScheduleImage(request, response) {
  const contentType = request.headers["content-type"] || "";
  const boundary = contentType.match(/boundary=(.+)$/);

  if (!boundary) {
    sendJson(response, 400, { error: "Missing upload boundary." });
    return;
  }

  const body = await readBody(request);
  const parts = parseMultipart(body, boundary[1]);
  const fields = Object.fromEntries(parts.filter((part) => !part.filename).map((part) => [part.name, part.data.toString("utf8")]));
  const image = parts.find((part) => part.name === "scheduleImage" && part.filename && part.data.length > 0);

  if (!["Jaxon", "Alexia"].includes(fields.person) || !image) {
    sendJson(response, 400, { error: "Person and schedule image are required." });
    return;
  }

  if (!image.contentType.startsWith("image/")) {
    sendJson(response, 400, { error: "The upload must be an image." });
    return;
  }

  if (isDatabaseStorageEnabled()) {
    sendJson(response, 201, await uploadScheduleImageToDatabase(fields.person, image));
    return;
  }

  const extension = safeUploadExtension(image.contentType, image.filename);
  const uploadName = crypto.randomUUID() + extension;
  const uploadPath = path.join(uploadsDir, uploadName);
  fs.writeFileSync(uploadPath, image.data);
  await queueGithubFileSync(uploadPath, "uploads/" + uploadName, "Add uploaded schedule image", true);

  const schedules = readSchedules();
  const savedImage = {
    id: crypto.randomUUID(),
    person: fields.person,
    image: "/uploads/" + uploadName,
    createdAt: new Date().toISOString()
  };

  schedules.images.push(savedImage);
  await saveSchedulesAndSync(schedules);
  sendJson(response, 201, savedImage);
}

async function handleDeleteScheduleImage(response, id) {
  if (isDatabaseStorageEnabled()) {
    await deleteScheduleImageFromDatabase(id);
    sendJson(response, 200, { ok: true });
    return;
  }

  const schedules = readSchedules();
  const image = schedules.images.find((item) => item.id === id);

  if (!image) {
    sendJson(response, 404, { error: "Schedule image not found." });
    return;
  }

  schedules.images = schedules.images.filter((item) => item.id !== id);
  await saveSchedulesAndSync(schedules);

  if (image.image && image.image.startsWith("/uploads/")) {
    const uploadPath = path.join(storageDir, image.image);

    if (uploadPath.startsWith(uploadsDir) && fs.existsSync(uploadPath)) {
      fs.unlinkSync(uploadPath);
      await queueGithubFileDelete("uploads/" + path.basename(image.image), "Delete uploaded schedule image", true);
    }
  }

  sendJson(response, 200, { ok: true });
}

function serveFile(response, requestedPath) {
  const cleanPath = requestedPath === "/" ? "/index.html" : decodeURIComponent(requestedPath);
  const baseDir = cleanPath.startsWith("/uploads/") ? storageDir : root;
  const filePath = path.normalize(path.join(baseDir, cleanPath));

  if (!filePath.startsWith(baseDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    response.end(data);
  });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");

    if (isWriteRequest(request, url.pathname) && !isAuthorized(request)) {
      sendJson(response, 401, { error: "Enter the site password to make changes." });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/memories") {
      if (isDatabaseStorageEnabled()) {
        sendJson(response, 200, await getMemoriesFromDatabase());
        return;
      }

      sendJson(response, 200, readMemories().map(normalizeMemory).sort((a, b) => b.startDate.localeCompare(a.startDate)));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/schedules") {
      if (isDatabaseStorageEnabled()) {
        sendJson(response, 200, await getSchedulesFromDatabase());
        return;
      }

      sendJson(response, 200, readSchedules());
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/github-sync-status") {
      sendJson(response, 200, githubSyncStatus());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/storage-status") {
      sendJson(response, 200, {
        mode: isDatabaseStorageEnabled() ? "database" : "local",
        hasDatabaseUrl: Boolean(databaseUrl),
        hasCloudinaryCloudName: Boolean(cloudinaryCloudName),
        hasCloudinaryApiKey: Boolean(cloudinaryApiKey),
        hasCloudinaryApiSecret: Boolean(cloudinaryApiSecret)
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/memories") {
      await handleCreateMemory(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/memories/") && url.pathname.endsWith("/photos")) {
      const parts = url.pathname.split("/");
      await handleAddMemoryPhotos(request, response, parts[3]);
      return;
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/memories/") && url.pathname.endsWith("/photos")) {
      const parts = url.pathname.split("/");
      await handleDeleteMemoryPhoto(request, response, parts[3]);
      return;
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/memories/")) {
      await handleDeleteMemory(request, response, url.pathname.split("/").pop());
      return;
    }

    if (request.method === "PATCH" && url.pathname.startsWith("/api/memories/")) {
      const parts = url.pathname.split("/");
      await handleUpdateCoverPhoto(request, response, parts[3]);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/schedules/events") {
      await handleCreateScheduleEvent(request, response);
      return;
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/schedules/events/")) {
      await handleDeleteScheduleEvent(response, url.pathname.split("/").pop());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/schedules/images") {
      await handleUploadScheduleImage(request, response);
      return;
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/schedules/images/")) {
      await handleDeleteScheduleImage(response, url.pathname.split("/").pop());
      return;
    }

    if (request.method === "GET") {
      serveFile(response, url.pathname);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed." });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: error.message || "Server error." });
  }
});

if (require.main === module) {
  importFromGithubAtStartup().finally(() => {
    server.listen(port, "0.0.0.0", () => {
      console.log("Alexia timeline server running at http://localhost:" + port);
    });
  });
}

module.exports = server;
