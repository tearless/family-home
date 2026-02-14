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
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_UPLOAD_BUCKET` (default: `family-home-media`)
5. Run:
   ```bash
   npm run dev
   ```
6. Open [http://localhost:3010](http://localhost:3010)

## Notes
- If AI API is not configured, photo categorization and AI blog creation use local fallback logic.
- If SMTP credentials are missing, the app runs but email sends are logged instead of sent.
- Uploaded images are stored in Supabase Storage bucket.
- App data is stored directly in Supabase Postgres.
