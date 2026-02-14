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
- Firebase Admin SDK (optional, for Google Storage persistence)

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
4. (Recommended on Vercel) Configure Google/Firebase Storage env values:
   - `FIREBASE_SERVICE_ACCOUNT_JSON` (full JSON as one line)  
     or `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
   - `FIREBASE_STORAGE_BUCKET`
   - optional `FIREBASE_DB_OBJECT` (default: `state/family-home.db`)
5. Run:
   ```bash
   npm run dev
   ```
6. Open [http://localhost:3010](http://localhost:3010)

## Notes
- If AI API is not configured, photo categorization and AI blog creation use local fallback logic.
- If SMTP credentials are missing, the app runs but email sends are logged instead of sent.
- If Firebase Storage is configured, uploaded images are stored in Google Cloud Storage.
- If Firebase Storage is configured, SQLite DB is snapshotted to bucket object (`FIREBASE_DB_OBJECT`) for Vercel persistence.
