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
