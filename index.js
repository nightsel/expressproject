import express from "express";
import cors from "cors";
import Sentiment from "sentiment";

const app = express();
const port = process.env.PORT || 10000;

app.use(cors({ origin: "*" }));
app.use(express.json());

const sentiment = new Sentiment();

// New endpoint: analyze text
app.post("/sentiment", (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: "No text provided" });
  }

  const result = sentiment.analyze(text);
  res.json({
    text,
    score: result.score, // > 0 positive, < 0 negative, 0 neutral
    comparative: result.comparative,
    words: result.words
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
