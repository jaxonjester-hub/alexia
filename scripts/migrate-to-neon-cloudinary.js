const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const cloudinary = require("cloudinary").v2;

const root = path.resolve(__dirname, "..");
const memoriesFile = path.join(root, "data", "memories.json");
const schedulesFile = path.join(root, "data", "schedules.json");
const uploadsDir = path.join(root, "uploads");

const requiredEnv = [
  "DATABASE_URL",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET"
];

const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
  console.error("Missing environment variables: " + missingEnv.join(", "));
  process.exit(1);
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function uploadPathFromUrl(url) {
  if (!url || !url.startsWith("/uploads/")) {
    return "";
  }

  return path.join(uploadsDir, path.basename(url));
}

async function uploadLocalImage(url, folder) {
  const filePath = uploadPathFromUrl(url);

  if (!filePath || !fs.existsSync(filePath)) {
    console.warn("Skipping missing image: " + url);
    return null;
  }

  const result = await cloudinary.uploader.upload(filePath, {
    folder,
    resource_type: "image"
  });

  return {
    imageUrl: result.secure_url,
    publicId: result.public_id
  };
}

async function migrateTrips(client) {
  const memories = readJson(memoriesFile, []);
  let migrated = 0;

  for (const memory of memories) {
    const exists = await client.query("select id from trips where id = $1", [memory.id]);

    if (exists.rowCount > 0) {
      console.log("Skipping existing trip: " + memory.title);
      continue;
    }

    await client.query("begin");

    try {
      await client.query(
        "insert into trips (id, title, note, start_date, end_date, created_at) values ($1, $2, $3, $4, $5, $6)",
        [
          memory.id,
          memory.title,
          memory.note,
          memory.startDate || memory.date,
          memory.endDate || null,
          memory.createdAt || new Date().toISOString()
        ]
      );

      let coverPhotoId = null;

      for (const photoUrl of memory.photos || []) {
        const upload = await uploadLocalImage(photoUrl, "alexia/trips");

        if (!upload) {
          continue;
        }

        const photoResult = await client.query(
          "insert into trip_photos (trip_id, image_url, cloudinary_public_id) values ($1, $2, $3) returning id",
          [memory.id, upload.imageUrl, upload.publicId]
        );

        if (!coverPhotoId || photoUrl === memory.coverPhoto) {
          coverPhotoId = photoResult.rows[0].id;
        }
      }

      if (coverPhotoId) {
        await client.query("update trips set cover_photo_id = $1 where id = $2", [coverPhotoId, memory.id]);
      }

      await client.query("commit");
      migrated += 1;
      console.log("Migrated trip: " + memory.title);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }

  return migrated;
}

async function migrateSchedules(client) {
  const schedules = readJson(schedulesFile, { events: [], images: [] });
  let migratedEvents = 0;
  let migratedImages = 0;

  for (const event of schedules.events || []) {
    const exists = await client.query("select id from schedule_events where id = $1", [event.id]);

    if (exists.rowCount > 0) {
      continue;
    }

    await client.query(
      "insert into schedule_events (id, person, day, title, start_time, end_time, note, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [
        event.id,
        event.person,
        event.day,
        event.title,
        event.startTime,
        event.endTime,
        event.note || "",
        event.createdAt || new Date().toISOString()
      ]
    );
    migratedEvents += 1;
  }

  for (const image of schedules.images || []) {
    const exists = await client.query("select id from schedule_images where id = $1", [image.id]);

    if (exists.rowCount > 0) {
      continue;
    }

    const upload = await uploadLocalImage(image.image, "alexia/schedules");

    if (!upload) {
      continue;
    }

    await client.query(
      "insert into schedule_images (id, person, image_url, cloudinary_public_id, created_at) values ($1, $2, $3, $4, $5)",
      [
        image.id,
        image.person,
        upload.imageUrl,
        upload.publicId,
        image.createdAt || new Date().toISOString()
      ]
    );
    migratedImages += 1;
  }

  return { migratedEvents, migratedImages };
}

async function main() {
  const client = await pool.connect();

  try {
    const migratedTrips = await migrateTrips(client);
    const { migratedEvents, migratedImages } = await migrateSchedules(client);
    console.log("Migration complete.");
    console.log("Trips migrated: " + migratedTrips);
    console.log("Schedule events migrated: " + migratedEvents);
    console.log("Schedule images migrated: " + migratedImages);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
