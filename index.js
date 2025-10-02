// Full-stack project with persistent votes and user feedback stored in PostgreSQL, accessible via Express API.

import express from "express";
import cors from "cors";
import Sentiment from "sentiment";
import pkg from "pg";
import { exec } from "child_process";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { Readable } from "stream";
import { createClient } from '@supabase/supabase-js';
import dotenv from "dotenv";
import { execFile } from 'child_process';
import os from "os";

import { spawn } from "child_process";
import ytdlp from 'yt-dlp-exec';

/*async function downloadYouTubeToBuffer(url) {
  return new Promise((resolve, reject) => {
    const ytdlp = spawn("yt-dlp", ["-x", "--audio-format", "mp3", "-o", "-", url], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    const chunks = [];
    let errorData = "";

    ytdlp.stdout.on("data", chunk => chunks.push(chunk));
    ytdlp.stderr.on("data", chunk => errorData += chunk.toString());

    ytdlp.on("error", err => reject(err));

    ytdlp.on("close", code => {
      if (code !== 0) return reject(new Error(`yt-dlp failed:\n${errorData}`));
      resolve(Buffer.concat(chunks)); // returns the full MP3 as a Buffer
    });
  });
}*/

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/*
const buffer = await downloadYouTubeToBuffer(url);
const filename = `temp_audio_${uuidv4()}.mp3`;

const { data, error } = await supabase
  .storage
  .from("audio")
  .upload(filename, buffer, { cacheControl: "3600", upsert: true });

if (error) throw error;

const publicUrl = supabase.storage.from("audio").getPublicUrl(filename).data.publicUrl;
return publicUrl;*/


const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // use the environment variable for security
  ssl: {
    rejectUnauthorized: false // allows Node to accept self-signed certificates
  }
});

const TEXTALIVE_TOKEN = process.env.TEXTALIVE_TOKEN;

 // Quick DB test
(async () => {
  const client = await pool.connect();
  const res = await client.query("SELECT NOW()");
  console.log("DB connected at:", res.rows[0].now);
  client.release();
})();

const app = express();
const port = process.env.PORT || 10000;


async function downloadYouTubeToBuffer(url) {
  return new Promise((resolve, reject) => {
    const ytdlp = spawn("yt-dlp", ["-x", "--audio-format", "mp3", "-o", "-", url], {
  stdio: ["ignore", "pipe", "pipe"]
});

    const chunks = [];
    let errorData = "";

    ytdlp.stdout.on("data", chunk => chunks.push(chunk));
    ytdlp.stderr.on("data", chunk => errorData += chunk.toString());

    ytdlp.on("error", err => reject(err));
    ytdlp.on("close", code => {
      if (code !== 0) return reject(new Error(`yt-dlp failed:\n${errorData}`));
      resolve(Buffer.concat(chunks)); // THIS is a real Buffer
    });

  //  ytdlp.stdin.end(); // close stdin
  });
}

async function cleanSupabaseTemp() {
  try {
    const { data: files, error: listError } = await supabase
      .storage
      .from('audio')
      .list();

    if (listError) return console.error("Supabase list error:", listError);

    const now = Date.now();
    const expiryMs = 15 * 60 * 1000; // 15 minutes old

    const filesToDelete = files
      .filter(file => {
        const created = new Date(file.created_at).getTime();
        return now - created > expiryMs;
      })
      .map(file => file.name);

    if (filesToDelete.length > 0) {
      const { error: deleteError } = await supabase
        .storage
        .from('audio')
        .remove(filesToDelete);

      if (deleteError) console.error("Supabase delete error:", deleteError);
      else console.log("Deleted Supabase temp files:", filesToDelete);
    }
  } catch (err) {
    console.error("Supabase cleanup failed:", err);
  }
}

// Run immediately and then periodically
cleanSupabaseTemp();
setInterval(cleanSupabaseTemp, 15 * 60 * 1000); // every 5 minutes
/*
function cleanOldFiles() {
  const tempFolder = path.join(process.cwd(), "temp_audio"); // <-- define tempFolder
  if (!fs.existsSync(tempFolder)) return; // no folder, nothing to clean

  const files = fs.readdirSync(tempFolder);
  const now = Date.now();

  files.forEach(file => {
    const filePath = path.join(tempFolder, file);
    const stats = fs.statSync(filePath);
    const ageMs = now - stats.mtimeMs;

    if (ageMs > 15 * 60 * 1000) { // older than 15 minutes
      fs.unlink(filePath, err => {
        if (err) console.error("Failed to delete old file:", err);
        else console.log("Deleted old file:", file);
      });
    }
  });
}

// Run immediately and periodically
cleanOldFiles();
setInterval(cleanOldFiles, 5 * 60 * 1000);*/

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.static("public"));

const sentiment = new Sentiment();

// ----- Sentiment Endpoint -----
app.post("/sentiment", (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "No text provided" });

  const result = sentiment.analyze(text);
  res.json({
    text,
    score: result.score,
    comparative: result.comparative,
    words: result.words
  });
});

// download and save to Supabase
app.get("/download-audio", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing YouTube URL" });

  const id = uuidv4();
  const tempPath = path.join(os.tmpdir(), `temp_audio_${id}.mp3`);
  const bucketName = "audio";

  try {
    // --- Download YouTube audio to temp file ---
    await new Promise((resolve, reject) => {
      const ytProcess = spawn("yt-dlp", [
        "-x",
        "--audio-format", "mp3",
        "-o", tempPath,
        url
      ]);

      let errData = "";
      ytProcess.stderr.on("data", chunk => errData += chunk.toString());
      ytProcess.on("error", reject);
      ytProcess.on("close", code => {
        if (code !== 0) return reject(new Error(`yt-dlp failed:\n${errData}`));
        resolve();
      });
    });

    // --- Read temp file ---
    const buffer = fs.readFileSync(tempPath);

    // --- Upload to Supabase ---
    const { error: uploadError } = await supabase
      .storage
      .from(bucketName)
      .upload(`temp_audio_${id}.mp3`, buffer, { cacheControl: "3600", upsert: true });

    if (uploadError) throw uploadError;

    const { data: signedData, error: signedError } = await supabase
      .storage
      .from(bucketName)
      .createSignedUrl(`temp_audio_${id}.mp3`, 60 * 60);

    if (signedError) throw signedError;
    if (!signedData || !signedData.signedUrl) throw new Error("Signed URL not returned");

    res.json({ url: signedData.signedUrl });

    // --- Cleanup temp file ---
    fs.unlinkSync(tempPath);

  } catch (err) {
    console.error("Download/upload error:", err);
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    res.status(500).json({ error: "Failed to download/upload audio" });
  }
});


app.get("/proxy-audio", async (req, res) => {
  try {
    const fileUrl = req.query.url;
    if (!fileUrl) {
      return res.status(400).json({ error: "Missing ?url parameter" });
    }

    // Fetch the file from Supabase (or any upstream URL)
    const upstream = await fetch(fileUrl);
    if (!upstream.ok) {
      return res.status(500).json({ error: "Failed to fetch audio" });
    }

    // Set correct Content-Type for audio
    res.setHeader("Content-Type", "audio/mpeg");

    // Convert Web ReadableStream → Node.js stream and pipe to response
    const nodeStream = Readable.from(upstream.body);
    nodeStream.pipe(res);

    nodeStream.on("end", () => {
      console.log("Audio streamed successfully");
    });

    nodeStream.on("error", (err) => {
      console.error("Stream error:", err);
      res.end();
    });

  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: "Proxy failed" });
  }
});






app.get("/temp-audio/:id", (req, res) => {
  const { id } = req.params;
  const tempFolder = path.join(process.cwd(), "temp_audio");
  const filePath = path.join(tempFolder, `temp_audio_${id}.mp3`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  res.sendFile(filePath, (err) => {
    if (err) {
      if (err.code === "ECONNABORTED") {
        console.warn("Client aborted connection (normal for small files)");
      } else {
        console.error("Error sending file:", err);
      }
    } else {
      console.log("File sent successfully");
    }
  });
});

// ----- Serve Waveform JSON -----
app.get("/waveform/:id", (req, res) => {
  const { id } = req.params;
  const tempFolder = path.join(process.cwd(), "temp_audio");
  const filePath = path.join(tempFolder, `waveform_${id}.json`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Waveform file not found" });
  }

  try {
    const jsonData = JSON.parse(fs.readFileSync(filePath, "utf8"));
    res.json(jsonData); // send as proper JSON
    console.log("Waveform sent successfully");
  } catch (err) {
    console.error("Error reading waveform file:", err);
    res.status(500).json({ error: "Failed to read waveform JSON" });
  }
});

/*app.get("/temp-audio", (req, res) => {
  const filePath = path.join(process.cwd(), "temp_audio.mp3");
  res.sendFile(filePath);
});*/

/*app.get("/api/lyrics", async (req, res) => {
  try {
    // Example proxy request to TextAlive
    const r = await fetch("https://api.textalive.jp/some-endpoint", {
      headers: { Authorization: `Bearer ${TEXTALIVE_TOKEN}` }
    });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});*/

// ----- Poll Backend -----

// Ping route (useful for waking Render backend)
app.get("/ping", (req, res) => {
  res.send("pong");
});

// Submit a vote

app.post("/vote", async (req, res) => {
  const { option, feedback } = req.body;
  if (!option) return res.status(400).json({ error: "No option provided" });

  try {
    await pool.query(
      "INSERT INTO votes (option, feedback) VALUES ($1, $2)",
      [option, feedback || null]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Get current results (aggregated)
// Only return vote counts, no feedback
app.get("/results", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT option, COUNT(*) AS vote_count FROM votes GROUP BY option"
    );

    const votesData = {};
    result.rows.forEach(row => {
      votesData[row.option] = parseInt(row.vote_count);
    });

    res.json(votesData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});


// ----- Start Server -----
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
