# Circle Space Website

A portfolio site with its own admin panel, built in the shape of an artist's
site: a fixed sidebar menu, a single image on the home page, and a page for
each body of work.

It ships **completely empty** — no images, no videos, no text. The first thing
you do is create your admin account and start filling it in.

## How the site is organised

- **Home** — one image, nothing else.
- **About** — a heading and your text.
- **A page per collection** — each collection is a body of work with its own
  title, a line beneath it, an optional introduction, and a grid of pieces.
  A collection holds either images or videos, and appears in the menu once
  you publish it.
- **Contact** — a message form and an email sign-up for studio updates.

Each piece in a collection carries a title, a year and a medium, shown under
the image as `2025 · Charcoal / Photography / Digital painting`.

## The admin panel

Everything is managed at `/admin`:

| Section | What it does |
| --- | --- |
| Site text | Your name in the sidebar, the home page image, about and contact text |
| Collections | Create them, order them, publish them, and fill them with work |
| Messages | Everything sent through the contact form |
| Studio updates | Email sign-ups, downloadable as a spreadsheet |
| Your account | Change your password |

Images are uploaded straight from the browser, up to 20 at a time. Videos are
added by pasting a YouTube or Vimeo link, which is embedded automatically.

## Running it on your computer

You need [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
npm start
```

Open <http://localhost:3000>. The first visit to
<http://localhost:3000/admin> asks you to create your admin account; that page
closes itself off once an account exists.

## Putting it online

The app is a plain Node server, so most hosts will run it. Two things matter:

1. **Set `SESSION_SECRET`** to a long random value, or the app refuses to start
   in production. Generate one with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. **Give it a disk that survives restarts** and point `DATA_DIR` at it. The
   database and your uploaded images live there. Without a persistent disk,
   everything you have entered is wiped on the next deploy.

Set `NODE_ENV=production` as well, which turns on secure cookies.
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

## About the contact form

Messages are **stored in the admin panel**, not emailed. Nothing is lost if an
email service is never set up, and there are no API keys to manage. The
Messages screen marks unread items and gives you a reply link that opens your
own mail app.

If you would rather have messages forwarded to your inbox, that means adding a
mail service (Resend, Postmark, SendGrid and similar all work) — a small change
to `src/routes/public.js`, where the message is saved.

## How it is built

No build step and no front-end framework — pages are rendered on the server, so
the whole thing stays easy to read and change.

- **Express 5** — web server
- **SQLite** (`better-sqlite3`) — storage, a single file on disk
- **EJS** — templates in `views/`
- **Multer** — image uploads
- **bcrypt** — password hashing

```
server.js            app setup, sessions, security headers, error pages
src/db.js            database schema and site-text storage
src/content.js       collections, works, messages and subscribers
src/routes/          public.js (the site) and admin.js (the panel)
src/middleware/      sign-in checks and CSRF protection
src/lib/             uploads, video-link parsing, session store
views/               page templates
public/css/          site.css (public) and admin.css (panel)
public/js/nav.js     opens the menu on narrow screens
data/                database and uploads — not in git
```

### Changing the look

The fonts are Playfair Display for headings and Lora for body text, loaded from
Google Fonts. Every colour, font and spacing value is a CSS custom property in
one block at the top of `public/css/site.css` — change that block and the whole
site follows.

## Security notes

- Passwords are hashed with bcrypt; they are never stored as written.
- Every admin form carries a CSRF token, uploads included.
- Signing in issues a fresh session to prevent session fixation.
- Uploads are limited by type and size and renamed on arrival, so a file name
  can never escape the upload folder.
- The contact form and the sign-up box carry a hidden field that bots fill in
  and people never see.
- The admin panel is marked `noindex` so search engines skip it.
