const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const port = process.env.PORT || 3000;
const root = __dirname;
const storageDir = process.env.STORAGE_DIR || root;
const dataDir = path.join(storageDir, "data");
const uploadsDir = path.join(storageDir, "uploads");
const memoriesFile = path.join(dataDir, "memories.json");

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

if (!fs.existsSync(memoriesFile)) {
  fs.writeFileSync(memoriesFile, "[]");
}

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function readMemories() {
  return JSON.parse(fs.readFileSync(memoriesFile, "utf8"));
}

function saveMemories(memories) {
  fs.writeFileSync(memoriesFile, JSON.stringify(memories, null, 2));
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

  const savedPhotos = uploadedPhotos.map((photo) => {
    const extension = safeUploadExtension(photo.contentType, photo.filename);
    const uploadName = crypto.randomUUID() + extension;
    const uploadPath = path.join(uploadsDir, uploadName);
    fs.writeFileSync(uploadPath, photo.data);
    return "/uploads/" + uploadName;
  });

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

function handleDeleteMemory(request, response, id) {
  const memories = readMemories().map(normalizeMemory);
  const memory = memories.find((item) => item.id === id);
  const remaining = memories.filter((item) => item.id !== id);

  if (!memory) {
    sendJson(response, 404, { error: "Memory not found." });
    return;
  }

  saveMemories(remaining);

  memory.photos.forEach((photo) => {
    if (!photo.startsWith("/uploads/")) {
      return;
    }

    const uploadPath = path.join(storageDir, photo);

    if (uploadPath.startsWith(uploadsDir) && fs.existsSync(uploadPath)) {
      fs.unlinkSync(uploadPath);
    }
  });

  sendJson(response, 200, { ok: true });
}

async function handleUpdateCoverPhoto(request, response, id) {
  const body = await readBody(request);
  const payload = JSON.parse(body.toString("utf8") || "{}");
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

    if (request.method === "GET" && url.pathname === "/api/memories") {
      sendJson(response, 200, readMemories().map(normalizeMemory).sort((a, b) => b.startDate.localeCompare(a.startDate)));
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/memories") {
      await handleCreateMemory(request, response);
      return;
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/memories/")) {
      handleDeleteMemory(request, response, url.pathname.split("/").pop());
      return;
    }

    if (request.method === "PATCH" && url.pathname.startsWith("/api/memories/")) {
      const parts = url.pathname.split("/");
      await handleUpdateCoverPhoto(request, response, parts[3]);
      return;
    }

    if (request.method === "GET") {
      serveFile(response, url.pathname);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed." });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Server error." });
  }
});

if (require.main === module) {
  server.listen(port, "0.0.0.0", () => {
  console.log("Alexia timeline server running at http://localhost:" + port);
  });
}

module.exports = server;
