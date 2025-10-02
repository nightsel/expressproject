// Full-stack project with persistent votes and user feedback stored in PostgreSQL, accessible via Express API.

import express from "express";
import cors from "cors";
import Sentiment from "sentiment";
//import pkg from "pg";
import { exec } from "child_process";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";



/*const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL // use the environment variable for security
});

const TEXTALIVE_TOKEN = process.env.TEXTALIVE_TOKEN;

 // Quick DB test
(async () => {
  const client = await pool.connect();
  const res = await client.query("SELECT NOW()");
  console.log("DB connected at:", res.rows[0].now);
  client.release();
})();*/

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

app.get("/download-audio", (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing YouTube URL" });

  const id = uuidv4();
  const tempFolder = path.join(process.cwd(), "temp_audio");
  if (!fs.existsSync(tempFolder)) fs.mkdirSync(tempFolder);

  const outputFile = path.join(tempFolder, `temp_audio_${id}.mp3`);
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
      // ✅ return UUID so frontend can access both audio + waveform
      res.json({ message: "Audio + waveform ready!", id });
    });
  });
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
/*
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
*/

// ----- Start Server -----
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
