Full-Stack Poll Backend
=======================

This is the back-end for the Full-Stack Poll on https://nightsel.github.io/Coding-projects/.

It allows users to:

- Pick their favorite feature of the website
- Optionally leave a comment

Votes and comments are stored in a private PostgreSQL database via the Express backend.  
Only the votes are displayed in the results; comments are stored securely and not shown.

Note: Submitting a vote may take a few seconds if the cloud service is still starting.

Database
--------

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
