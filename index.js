import express from "express";
import cors from "cors";
import Sentiment from "sentiment";

import pkg from "pg";

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL // safer way
});

// quick test
(async () => {
  const client = await pool.connect();
  const res = await client.query("SELECT NOW()");
  console.log("DB connected at:", res.rows[0].now);
  client.release();
})();

const app = express();
const port = process.env.PORT || 10000;

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

// ----- Poll Backend -----
let votes = {
  Design: 0,
  Projects: 0,
  Interactivity: 0,
  Content: 0
};

// Ping route (useful for waking Render backend)
app.get("/ping", (req, res) => {
  res.send("pong");
});

// Submit a vote
app.post("/vote", (req, res) => {
  const { option } = req.body;
  if (!option || !votes.hasOwnProperty(option)) {
    return res.status(400).json({ error: "Invalid vote option" });
  }
  votes[option]++;
  res.json({ success: true, votes });
});

// Get current results
app.get("/results", (req, res) => {
  res.json({ votes });
});

// ----- Start Server -----
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
