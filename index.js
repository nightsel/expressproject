// Full-stack project with persistent votes and user feedback stored in PostgreSQL, accessible via Express API.

import express from "express";
import cors from "cors";
import Sentiment from "sentiment";
import pkg from "pg";

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL // use the environment variable for security
});

// Quick DB test
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
app.get("/results", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT option, COUNT(*) AS vote_count, ARRAY_AGG(feedback) AS feedbacks FROM votes GROUP BY option"
    );

    // Format for frontend
    const votesData = {};
    result.rows.forEach(row => {
      votesData[row.option] = {
        count: parseInt(row.vote_count),
        feedbacks: row.feedbacks.filter(f => f !== null) // remove nulls
      };
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
