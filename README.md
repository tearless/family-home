# family-home

Blue-tone iOS-style family website for Anton, Olivia, and Eliana.

## Features
- Dynamic landing page with animated hero photos
- Family blog system (list/detail)
- Recent updates section combining photos and blog posts
- Member approval + email verification flow
- Family admin login (initial password: `0000`)
- Member-only album access, with direct album access for admin-logged family users
- Gallery management in `/album/manage` (family only)
- AI-based photo auto-categorization (with fallback categorizer)
- Admin API settings for external AI integrations
- Admin blog publishing (manual + AI prompt)
- Emoji reactions + moderated comments (EN/KR filter)
- Comment email alerts with one-click delete link

## Stack
- Node.js
- Express + EJS
- Supabase Postgres (`pg`)
- Supabase Storage (`@supabase/supabase-js`)
- `express-session`
- Nodemailer

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment:
   ```bash
   cp .env.example .env
   ```
3. Update `.env` values (`SESSION_SECRET`, SMTP values, optional AI settings).
4. Configure Supabase env values:
   - `SUPABASE_DB_URL` (Supabase Postgres connection string)
   - `SUPABASE_DB_SSL` (`true` by default)
   - `DB_SSL_MODE` (`no-verify` by default for Supabase TLS chain compatibility on some runtimes)
   - `DB_ALLOW_SELF_SIGNED` (`true` by default; set `false` to enforce strict certificate verification)
   - `DB_POOL_MAX` (serverless recommended `1`)
   - `DB_IDLE_TIMEOUT_MS` (optional, default `5000`)
   - `DB_CONNECTION_TIMEOUT_MS` (optional, default `8000`)
   - `DB_STATEMENT_TIMEOUT_MS` (optional, default `12000`)
   - `DB_QUERY_TIMEOUT_MS` (optional, default `12000`)
   - `DB_BOOTSTRAP_ON_START` (`auto` recommended on Vercel; skips heavy bootstrap once schema exists)
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_UPLOAD_BUCKET` (default: `family-home-media`)
   - `SUPABASE_SIGNED_URL_EXPIRES_IN` (seconds, default: `259200`)
   - Supabase Storage bucket visibility: set the upload bucket to **Private**.
5. Run:
   ```bash
   npm run dev
   ```
6. Open [http://localhost:3010](http://localhost:3010)

## Notes
- If AI API is not configured, photo categorization and AI blog creation use local fallback logic.
- If SMTP credentials are missing, the app runs but email sends are logged instead of sent.
- Uploaded images are stored as Supabase Storage references (`sb://bucket/path`) in DB.
- Pages render private bucket images via signed URLs at request time.
- App data is stored directly in Supabase Postgres.
