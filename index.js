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
setInterval(cleanOldFiles, 5 * 60 * 1000);

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

/*app.get("/download-audio", (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing YouTube URL" });

  const id = uuidv4();
  const tempFolder = path.join(process.cwd(), "temp_audio");
  if (!fs.existsSync(tempFolder)) fs.mkdirSync(tempFolder);

  const outputFile = path.join(tempFolder, `temp_audio_${id}.mp3`);
  const fileBuffer = fs.readFileSync(outputFile);
  const { data, error } = await supabase
    .storage
    .from('audio')        // your bucket name
    .upload(`temp_audio_${id}.mp3`, fileBuffer, { upsert: true });
  if (error) throw error;
  const publicUrl = supabase.storage.from('audio').getPublicUrl(`temp_audio_${id}.mp3`).data.publicUrl;
  const waveformFile = path.join(tempFolder, `waveform_${id}.json`);

  // yt-dlp command to download mp3
  const cmd = `yt-dlp -x --audio-format mp3 -o "${outputFile}" ${url}`;
  console.log("Running command:", cmd);

  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Error downloading audio" });
    }

    console.log(stdout);

    // Now generate waveform JSON using audiowaveform
    const waveformCmd = `audiowaveform -i "${outputFile}" -o "${waveformFile}" -b 8`;
    exec(waveformCmd, (waveErr, waveStdout, waveStderr) => {
      if (waveErr) {
        console.error(waveErr);
        return res.status(500).json({ error: "Error generating waveform" });
      }

      console.log("Waveform generated:", waveformFile);
      //  return UUID so frontend can access both audio + waveform
      res.json({ message: "Audio + waveform ready!", id });
    });
  });
});

app.get("/download-audio", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing YouTube URL" });

  const id = uuidv4();
  const filename = `temp_audio_${id}.mp3`;
  const bucketName = "audio"; // your Supabase bucket

  try {
    // 1 Download audio to memory using yt-dlp
    const { stdout, stderr } = await new Promise((resolve, reject) => {
      const cmd = `yt-dlp -x --audio-format mp3 -o - ${url}`; // -o - streams to stdout
      exec(cmd, { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve({ stdout, stderr });
      });
    });

    // stdout contains the MP3 buffer
    const buffer = stdout;

    // 2 Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase
      .storage
      .from(bucketName)
      .upload(filename, buffer, { cacheControl: "3600", upsert: true });

    if (uploadError) throw uploadError;

    // 3 Generate public URL
    const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(filename);
    const publicUrl = urlData.publicUrl;

    // 4 Generate waveform JSON in memory using audiowaveform CLI
    const waveformBuffer = await new Promise((resolve, reject) => {
      const cmd = `audiowaveform -i - -o - -b 8`; // input/output via stdin/stdout
      const proc = exec(cmd, { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve(stdout);
      });
      proc.stdin.write(buffer);
      proc.stdin.end();
    });

    const waveformJson = JSON.parse(waveformBuffer.toString("utf8"));

    //  Return public URL + waveform
    res.json({
      id,
      url: publicUrl,
      waveform: waveformJson.data
    });

  } catch (err) {
    console.error("Download/upload error:", err);
    res.status(500).json({ error: "Failed to download/upload audio" });
  }
});

app.get("/download-audio", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing YouTube URL" });

  const id = uuidv4();
  const filename = `temp_audio_${id}.mp3`;
  const bucketName = "audio"; // your private bucket

  try {
    // 1️⃣ Download audio to memory using yt-dlp
    const buffer = await new Promise((resolve, reject) => {
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
        resolve(Buffer.concat(chunks));
      });
    });

    // 2️⃣ Upload MP3 buffer to Supabase Storage (private bucket)
    const { error: uploadError } = await supabase
      .storage
      .from(bucketName)
      .upload(filename, buffer, { cacheControl: "3600", upsert: true });
    if (uploadError) throw uploadError;

    // 3️⃣ Generate a signed URL (valid 1 hour)
    const { data: signedData, error: signedError } = await supabase
      .storage
      .from(bucketName)
      .createSignedUrl(filename, 60 * 60); // 1 hour
    if (signedError) throw signedError;

    const publicUrl = signedData.signedUrl;

    // 4️⃣ Generate waveform JSON in memory using audiowaveform
    const waveformBuffer = await new Promise((resolve, reject) => {
      const proc = spawn("audiowaveform", ["-i", "-", "-o", "-", "-b", "8"], {
        stdio: ["pipe", "pipe", "pipe"]
      });

      const chunks = [];
      let errorData = "";

      proc.stdout.on("data", chunk => chunks.push(chunk));
      proc.stderr.on("data", chunk => errorData += chunk.toString());

      proc.on("error", err => reject(err));
      proc.on("close", code => {
        if (code !== 0) return reject(new Error(`audiowaveform failed:\n${errorData}`));
        resolve(Buffer.concat(chunks));
      });

      proc.stdin.write(buffer);
      proc.stdin.end();
    });

    const waveformJson = JSON.parse(waveformBuffer.toString("utf8"));

    // 5️⃣ Return signed URL + waveform
    res.json({
      id,
      url: publicUrl,
      waveform: waveformJson.data
    });

  } catch (err) {
    console.error("Download/upload error:", err);
    res.status(500).json({ error: "Failed to download/upload audio" });
  }
});


// --- Download YouTube, upload to Supabase, generate waveform ---
app.get("/download-audio", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing YouTube URL" });

  const id = uuidv4();
  const filename = `temp_audio_${id}.mp3`;
  const bucketName = "audio"; // your private bucket
  const tempFile = path.join(os.tmpdir(), `audio_${id}.mp3`);

  try {
    // 1 Download audio to temp file
    await new Promise((resolve, reject) => {
      const ytdlp = spawn("yt-dlp", ["-x", "--audio-format", "mp3", "-o", tempFile, url]);
      let errorData = "";

      ytdlp.stderr.on("data", chunk => errorData += chunk.toString());
      ytdlp.on("error", err => reject(err));
      ytdlp.on("close", code => {
        if (code !== 0) return reject(new Error(`yt-dlp failed:\n${errorData}`));
        resolve();
      });
    });

    // 2 Read file and upload to Supabase
    const buffer = fs.readFileSync(tempFile);
    const { error: uploadError } = await supabase
      .storage
      .from(bucketName)
      .upload(filename, buffer, { cacheControl: "3600", upsert: true });
    if (uploadError) throw uploadError;

    //  Generate signed URL (valid 1 hour)
    const { data: signedData, error: signedError } = await supabase
      .storage
      .from(bucketName)
      .createSignedUrl(filename, 60 * 60); // 1 hour
    if (signedError) throw signedError;
    const signedUrl = signedData.signedUrl;

    // 4 Generate waveform JSON from temp file
    const waveformBuffer = await new Promise((resolve, reject) => {
      const proc = spawn("audiowaveform", ["-i", tempFile, "-o", "-", "-b", "8"]);
      const chunks = [];
      let errorData = "";

      proc.stdout.on("data", c => chunks.push(c));
      proc.stderr.on("data", c => errorData += c.toString());

      proc.on("error", err => reject(err));
      proc.on("close", code => {
        if (code !== 0) return reject(new Error(`audiowaveform failed:\n${errorData}`));
        resolve(Buffer.concat(chunks));
      });
    });

    const waveformJson = JSON.parse(waveformBuffer.toString("utf8"));

    // 5 Cleanup temp file
    fs.unlinkSync(tempFile);

    // 6 Return signed URL + waveform
    res.json({
      id,
      url: signedUrl,
      waveform: waveformJson.data
    });

  } catch (err) {
    console.error("Download/upload error:", err);
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    res.status(500).json({ error: "Failed to download/upload audio" });
  }
});

app.get("/download-audio", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing YouTube URL" });

  const id = uuidv4();
  const tempFolder = path.join(process.cwd(), "temp_audio");
  if (!fs.existsSync(tempFolder)) fs.mkdirSync(tempFolder);

  const tempMp3 = path.join(tempFolder, `temp_audio_${id}.mp3`);
  const tempWav = path.join(tempFolder, `temp_audio_${id}.wav`);
  const bucketName = "audio";

  try {
    // 1️⃣ Download MP3 with yt-dlp
    await new Promise((resolve, reject) => {
      const ytdlp = spawn("yt-dlp", [
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "-o", tempMp3,
        url
      ]);

      let stderr = "";
      ytdlp.stderr.on("data", chunk => stderr += chunk.toString());
      ytdlp.on("error", err => reject(err));
      ytdlp.on("close", code => code === 0 ? resolve() : reject(new Error(stderr)));
    });

    // 2️⃣ Convert MP3 → WAV for audiowaveform
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", ["-y", "-i", tempMp3, tempWav]);
      let stderr = "";
      ffmpeg.stderr.on("data", chunk => stderr += chunk.toString());
      ffmpeg.on("error", err => reject(err));
      ffmpeg.on("close", code => code === 0 ? resolve() : reject(new Error(stderr)));
    });

    // 3️⃣ Generate waveform JSON
    const waveformBuffer = await new Promise((resolve, reject) => {
      const proc = spawn("audiowaveform", ["-i", tempWav, "-o", "-", "-b", "8"]);

      const chunks = [];
      let stderr = "";
      proc.stdout.on("data", c => chunks.push(c));
      proc.stderr.on("data", c => stderr += c);
      proc.on("error", err => reject(err));
      proc.on("close", code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(stderr)));
    });

    const waveformJson = JSON.parse(waveformBuffer.toString("utf8"));

    // 4️⃣ Upload MP3 to Supabase (private bucket)
    const mp3Buffer = fs.readFileSync(tempMp3);
    const { error: uploadError } = await supabase
      .storage
      .from(bucketName)
      .upload(`temp_audio_${id}.mp3`, mp3Buffer, { cacheControl: "3600", upsert: true });
    if (uploadError) throw uploadError;

    // 5️⃣ Generate signed URL
    const { data: signedData, error: signedError } = await supabase
      .storage
      .from(bucketName)
      .createSignedUrl(`temp_audio_${id}.mp3`, 60 * 60);
    if (signedError) throw signedError;

    // 6️⃣ Cleanup temp files
    fs.unlinkSync(tempMp3);
    fs.unlinkSync(tempWav);

    res.json({
      id,
      url: signedData.signedUrl,
      waveform: waveformJson.data
    });

  } catch (err) {
    console.error("Download/upload error:", err);
    res.status(500).json({ error: "Failed to download/upload audio" });
  }
});

app.get("/download-audio", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing YouTube URL" });

  const id = uuidv4();
  const tempFolder = path.join(process.cwd(), "temp_audio");
  if (!fs.existsSync(tempFolder)) fs.mkdirSync(tempFolder);

  const tempMp3 = path.join(tempFolder, `temp_audio_${id}.mp3`);
  const tempWav = path.join(tempFolder, `temp_audio_${id}.wav`);

  try {
    // 1️⃣ Download MP3 using yt-dlp
    await new Promise((resolve, reject) => {
      const ytdlp = spawn("yt-dlp", ["-x", "--audio-format", "mp3", "-o", tempMp3, url]);
      let stderr = "";
      ytdlp.stderr.on("data", chunk => stderr += chunk.toString());
      ytdlp.on("error", err => reject(err));
      ytdlp.on("close", code => code === 0 ? resolve() : reject(new Error(stderr)));
    });

    // 2️⃣ Convert MP3 → WAV (16-bit PCM mono) via ffmpeg
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", ["-y", "-i", tempMp3, "-ac", "1", "-ar", "44100", "-sample_fmt", "s16", tempWav]);
      let stderr = "";
      ffmpeg.stderr.on("data", chunk => stderr += chunk.toString());
      ffmpeg.on("error", err => reject(err));
      ffmpeg.on("close", code => code === 0 ? resolve() : reject(new Error(stderr)));
    });

    // 3️⃣ Generate waveform JSON
    const waveformBuffer = await new Promise((resolve, reject) => {
      const proc = spawn("audiowaveform", ["-i", tempWav, "-o", "-", "-b", "8"]);
      let chunks = [];
      let stderr = "";

      proc.stdout.on("data", chunk => chunks.push(chunk));
      proc.stderr.on("data", chunk => stderr += chunk.toString());

      proc.on("error", err => reject(err));
      proc.on("close", code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(stderr)));
    });

    const waveformJson = JSON.parse(waveformBuffer.toString("utf8"));

    // 4️⃣ Upload MP3 to Supabase Storage
    const filename = `temp_audio_${id}.mp3`;
    const { error: uploadError } = await supabase
      .storage
      .from("audio")
      .upload(filename, fs.readFileSync(tempMp3), { cacheControl: "3600", upsert: true });
    if (uploadError) throw uploadError;

    // 5️⃣ Generate signed URL
    const { data: signedData, error: signedError } = await supabase
      .storage
      .from("audio")
      .createSignedUrl(filename, 60 * 60); // 1 hour
    if (signedError) throw signedError;

    // ✅ Return URL + waveform
    res.json({
      id,
      url: signedData.signedUrl,
      waveform: waveformJson.data
    });

    // Optional cleanup
    fs.unlinkSync(tempMp3);
    fs.unlinkSync(tempWav);

  } catch (err) {
    console.error("Download/upload error:", err);
    res.status(500).json({ error: "Failed to download/upload audio" });
  }
});*/

app.get("/download-audio", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing YouTube URL" });

  const id = uuidv4();
  const filename = `temp_audio_${id}.mp3`;
  const bucketName = "audio";

  try {
    // Download MP3 into memory
    const buffer = await new Promise((resolve, reject) => {
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
        resolve(Buffer.concat(chunks));
      });
    });

    // Upload to Supabase
    const { error: uploadError } = await supabase
      .storage
      .from(bucketName)
      .upload(filename, buffer, { cacheControl: "3600", upsert: true });
    if (uploadError) throw uploadError;

    // Generate a signed URL (1 hour)
    const { data: signedData, error: signedError } = await supabase
      .storage
      .from(bucketName)
      .createSignedUrl(filename, 60 * 60);
    if (signedError) throw signedError;

    res.json({ url: signedData.signedUrl });
  } catch (err) {
    console.error("Download/upload error:", err);
    res.status(500).json({ error: "Failed to download/upload audio" });
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
