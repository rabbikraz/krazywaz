# Rabbi Kraz Shiurim

A Next.js web app for Rabbi Kraz's shiurim (Torah lectures) with admin panel, file uploads, RSS feed sync, and YouTube playlist integration. Runs on Cloudflare Workers + D1 + R2.

## Features

- 🎙️ **RSS Feed Sync** — Import shiurim from a podcast RSS feed
- 🎵 **Audio Player** — Playback with speed controls and range-request streaming
- 📄 **Source Sheet Manager** — Upload PDFs, clip source regions, attach to shiurim
- 🎬 **YouTube Integration** — Playlist sync and categorization by parsha
- 📤 **File Uploads** — Audio, video, PDF, and image uploads to Cloudflare R2
- 👨‍💼 **Admin Panel** — Full CRUD for shiurim, bulk link import, analytics
- 📱 **Responsive** — Mobile-first design

## Tech Stack

- **Next.js 15** with App Router (via [OpenNext for Cloudflare](https://opennextjs.org/cloudflare))
- **Cloudflare Workers** — Edge runtime
- **Cloudflare D1** — SQLite database
- **Cloudflare R2** — Object storage for media files
- **Drizzle ORM** — Type-safe database queries
- **Tailwind CSS** — Styling
- **TypeScript**

## Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm i -g wrangler`)
- A Cloudflare account

## Local Development

### 1. Clone and install

```bash
git clone https://github.com/minevich/krazywaz.git
cd krazywaz
npm install
```

### 2. Configure environment

Create a `.dev.vars` file in the project root (this is gitignored):

```env
ADMIN_SETUP_TOKEN=your-setup-token
RSS_FEED_URL=https://your-podcast-rss-feed.com/feed.xml
YOUTUBE_API_KEY=your-youtube-api-key
OCR_SPACE_API_KEY=your-ocr-space-api-key
```

The `wrangler.toml` already configures the D1 database and R2 bucket bindings for local dev.

### 3. Run database migrations

```bash
npm run db:migrate -- --local
```

This creates all tables in the local D1 database.

### 4. Start the dev server

```bash
npm run preview
```

This builds the app and starts a local Wrangler dev server at `http://localhost:8787`.

### 5. Create an admin user

With the dev server running, create your admin account:

```bash
curl -X POST http://localhost:8787/api/admin/create-user \
  -H "Content-Type: application/json" \
  -H "X-Setup-Token: your-setup-token" \
  -d '{"email": "you@example.com", "password": "your-password", "name": "Admin"}'
```

Then log in at `http://localhost:8787/admin`.

### Resetting the local database (if needed)

```bash
rm -rf .wrangler/state
npm run db:migrate -- --local
```

Then recreate your admin user.

## Deploying to Cloudflare

### 1. Authenticate with Cloudflare

```bash
wrangler login
```

### 2. Create the D1 database (first time only)

```bash
wrangler d1 create rabbi-kraz-db
```

Copy the `database_id` into `wrangler.toml` under `[[d1_databases]]`.

### 3. Create the R2 bucket (first time only)

```bash
wrangler r2 bucket create krazywaz-media
```

### 4. Run production migrations

```bash
npm run db:migrate
```

### 5. Set secrets

```bash
wrangler secret put ADMIN_SETUP_TOKEN
wrangler secret put RSS_FEED_URL
wrangler secret put YOUTUBE_API_KEY
```

### 6. Deploy

The best option is to configure Cloudflare Pages to deploy from this repository automatically.

Alternatively, you can deploy manually:

```bash
npm run deploy
```

This builds the OpenNext worker bundle and deploys to Cloudflare Workers.

### 7. Create admin user (first deploy only)

```bash
curl -X POST https://your-worker.workers.dev/api/admin/create-user \
  -H "Content-Type: application/json" \
  -H "X-Setup-Token: your-setup-token" \
  -d '{"email": "you@example.com", "password": "your-password", "name": "Admin"}'
```

After creating your admin user, you can remove the `ADMIN_SETUP_TOKEN` secret for security:

```bash
wrangler secret delete ADMIN_SETUP_TOKEN
```

### Production environment variables

Set `NEXT_PUBLIC_BASE_URL` in `wrangler.toml` under `[env.production.vars]` to your production URL.

## Project Structure

```
krazywaz/
├── app/                     # Next.js App Router pages
│   ├── admin/               # Admin panel + source manager
│   ├── api/                 # API routes (auth, upload, shiurim, rss, media)
│   ├── playlists/           # YouTube playlist pages
│   └── page.tsx             # Homepage
├── components/              # React components
│   ├── FileUploader.tsx     # Drag-and-drop file upload with progress
│   ├── ShiurForm.tsx        # Create/edit shiur form
│   ├── SourceManager.tsx    # PDF source clipping tool
│   ├── SourceSheetViewer.tsx # Source display on shiur pages
│   ├── AudioPlayer.tsx      # Audio playback
│   └── ...
├── lib/                     # Shared utilities
│   ├── db.ts                # D1 + R2 access helpers
│   ├── schema.ts            # Drizzle ORM schema
│   └── auth.ts              # Auth (SHA-256 password hashing)
├── migrations/              # D1 SQL migrations
├── wrangler.toml            # Cloudflare Workers config
└── .dev.vars                # Local env vars (gitignored)
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run preview` | Build and run locally with Wrangler |
| `npm run deploy` | Build and deploy to Cloudflare |
| `npm run db:migrate` | Run D1 migrations (production) |
| `npm run db:migrate -- --local` | Run D1 migrations (local) |
| `npm run db:studio` | Open Drizzle Studio (database GUI) |
| `npm run dev` | Next.js dev server (no Cloudflare bindings) |
| `npm run lint` | Run ESLint |

## License

Private and proprietary.
