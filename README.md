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
- SQLite (`better-sqlite3`)
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
4. Run:
   ```bash
   npm run dev
   ```
5. Open [http://localhost:3010](http://localhost:3010)

## Notes
- If AI API is not configured, photo categorization and AI blog creation use local fallback logic.
- If SMTP credentials are missing, the app runs but email sends are logged instead of sent.
