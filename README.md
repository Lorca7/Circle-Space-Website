# Circle Space Website

A small website with its own admin panel. The public site shows a gallery,
embedded videos, an about page, a contact page and any extra pages you create.
Everything on it is edited from `/admin` — there is no content in the code.

It ships **completely empty**: no photos, no video links, no text. The first
thing you do is create your admin account and start filling it in.

## What is in it

| Part | What it does |
| --- | --- |
| Public site | Home, Gallery, Videos, About, Contact, plus your own pages |
| `/admin` | Password-protected panel where all the content is managed |
| Photos | Upload JPG/PNG/WebP/GIF/AVIF, add captions and alt text, set the order |
| Video links | Paste a YouTube or Vimeo link; it is embedded automatically |
| Pages | Write extra pages, publish them to add them to the menu |
| Links | Outbound links for the footer and contact page |
| Site text | Site name, tagline, home page headline, about and contact text |

## Running it on your computer

You need [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
npm start
```

Then open <http://localhost:3000>. The first visit to
<http://localhost:3000/admin> asks you to create your admin account. That page
closes itself off once an account exists.

## Putting it online

The app is a plain Node server, so most hosts will run it. Two things matter:

1. **Set `SESSION_SECRET`** to a long random value, or the app refuses to start
   in production. Generate one with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. **Give it a disk that survives restarts** and point `DATA_DIR` at it. The
   database and your uploaded photos live there. Without a persistent disk,
   everything you have typed in is wiped on the next deploy.

Set `NODE_ENV=production` too, which turns on secure cookies.

See `.env.example` for every setting.

### Render

Create a **Web Service** from this repository:

- Build command: `npm install`
- Start command: `npm start`
- Add a **Disk**, mount it at `/var/data`, and set `DATA_DIR=/var/data`
- Add environment variables `SESSION_SECRET` and `NODE_ENV=production`

The same shape works on Railway, Fly.io or a plain VPS — a Node process, a
persistent disk, and those environment variables.

## Command line helpers

Create the admin account, or reset a lost password:

```bash
npm run create-admin -- you@example.com 'a-long-password'
```

Wipe all content back to blank, keeping your admin account:

```bash
npm run reset-content -- --yes
```

## How it is built

No build step and no front-end framework — the pages are rendered on the
server, so the whole thing is easy to read and change.

- **Express 5** — web server
- **SQLite** (`better-sqlite3`) — content storage, a single file on disk
- **EJS** — HTML templates in `views/`
- **Multer** — image uploads
- **bcrypt** — password hashing

```
server.js            app setup, sessions, security headers, error pages
src/db.js            schema and site-text storage
src/content.js       photos, videos, pages and links
src/routes/          public.js (the site) and admin.js (the panel)
src/middleware/      sign-in checks and CSRF protection
src/lib/             uploads, video-link parsing, session store
views/               page templates
public/css/          site.css (public) and admin.css (panel)
data/                database and uploads — not in git
```

### Re-skinning it

Every colour, font and spacing value is a CSS custom property at the top of
`public/css/site.css`. Change that one block and the whole public site follows,
in both light and dark mode.

## Security notes

- Passwords are hashed with bcrypt; they are never stored as written.
- Every admin form carries a CSRF token.
- Signing in issues a fresh session to prevent session fixation.
- Uploads are restricted by type and size, and are renamed on arrival, so a
  file name can never escape the upload folder.
- The admin panel is marked `noindex` so search engines skip it.
