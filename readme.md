- The Render backend is hosted at [https://expressproject-al0i.onrender.com/](https://expressproject-al0i.onrender.com/).  
  The front-end at this URL is irrelevant; only the API routes are up to date and usable.

Full-Stack Poll Backend
=======================

This is the back-end for the Full-Stack Poll on https://nightsel.github.io/Coding-projects/.

Note: The cloud service is hosted on [Render](https://render.com/).  
Submitting a vote may take a few seconds if the services are still starting.

It allows users to:

- Pick their favorite feature of the website
- Optionally leave a comment

Votes and comments are stored in a private PostgreSQL database via the Express backend.  
Only the votes are displayed in the results; comments are stored securely and not shown.

Database
--------

The PostgreSQL database is also hosted on Render. The database documentation is [here](https://render.com/docs/postgresql).
Votes and optional feedback are stored in PostgreSQL. Example table structure:

CREATE TABLE votes (
  id SERIAL PRIMARY KEY,
  option TEXT NOT NULL,
  feedback TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

How It Works
------------

- The front-end sends a POST request to /vote with the chosen option and optional feedback.
- Votes are inserted into the database securely.
- A GET request to /results returns current vote counts (comments are never displayed).
- When the front-end page is opened or a tab is switched, it automatically pings the back-end on Render to wake the cloud service and database, so submitting a vote doesn’t take a long time.


# Audio Player Backend

This backend powers the audio player features for the front-end.  
It handles temporary audio hosting, downloading/converting remote audio, streaming with range support, and fetching lyrics.

---

## Features

- **Download & convert audio** from YouTube / SoundCloud using `yt-dlp`.
- **Temporary hosting** of audio files on Supabase (`audio` bucket).
- **Demo track** streaming from Supabase (`defaulttrack` bucket).
- **Proxy arbitrary audio URLs** with range support for smooth playback.
- **Fetch lyrics** from multiple sources (Lyrical Nonsense, LyricsTranslate, Utaten).
- **Automatic cleanup** of temporary audio older than 15 minutes.

---

## Routes

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/lyrics?artist=...&song=...` | Aggregates lyrics lines from available sources. Returns JSON `{ lines: [...] }`. |
| `GET` | `/download-audio?url=...` | Downloads/converts source URL, uploads to Supabase as `temp_audio_[uuid].mp3`, returns `{ url: "<signed-url>" }`. |
| `GET` | `/proxy-audio?url=...` | Streams the audio from a signed URL, supporting range requests for playback. |
| `GET` | `/luna` | Streams preloaded demo track `lunastar.mp3` from Supabase with range support. |
| `GET` | `/temp-audio/:id` | Debug: serves local temp audio file `temp_audio_{id}.mp3` if available. |
| `GET` | `/my-audio` | Debug: serves `public/proxy-audio.mp3` from project. |

---

## Implementation Details

- **Supabase**:
  - `audio` bucket for temporary uploads.
  - `defaulttrack` bucket contains demo track `lunastar.mp3`.
  - Signed URLs are generated with 1-hour validity, but temporary audio files are **automatically deleted after 15 minutes**, so the URL may stop working sooner.
- **Audio download**:
  - Uses `yt-dlp` to extract MP3 from a valid audio URL as a buffer, uploads to Supabase.
- **Proxy / Range support**:
  - `/proxy-audio` and `/luna` stream audio from a URL. Users can jump to any point in the track.
- **Lyrics**:
  - Tries Lyrical Nonsense first, then LyricsTranslate, then Utaten.
- **Cleanup**:
  - Deletes temporary audio older than 15 minutes, runs at startup and every 15 minutes.

---
