# Acropolis Maranatha Academy — Cloud School Management

A responsive, full-stack school management application designed for Android and Windows browsers. The school logo is served locally from `public/school-logo.png` and the UI uses a slide-in side menu with smooth transitions.

## Features in this package

- Cloud-ready, multi-school tenancy: every record is scoped to a school ID on the server.
- First-run school registration and administrator creation.
- Server-side password hashing (bcrypt), secure HTTP-only session cookies, login rate limiting and role checks.
- Student register/edit/archive, class, guardian contacts, fee totals and paid balances.
- Examination marks by subject and term.
- Fee payments and unique receipts.
- Staff accounts with Administrator, Teacher and Bursar roles.
- Reports, activity audit log, JSON backup and CSV student export.
- Responsive mobile/desktop layout, keyboard accessible controls and reduced-motion support.
- PostgreSQL persistence. Data is shared across authorized devices when deployed to a common server/database.

## Local development

Requirements: Node.js 20+ and PostgreSQL 14+.

1. Create a PostgreSQL database.
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` and a strong unique `SESSION_SECRET`.
3. Set `PGSSL=false` for a local database if SSL is not configured; use `PGSSL=true` if your provider requires SSL.
4. Run `npm install`.
5. Run `npm start`.
6. Open `http://localhost:3000` in Chrome or Edge.

The app creates the schema tables at startup. Keep the database URL and session secret private.

## Deployment

This is a deployable application package, not a live-hosted service yet. To make it available over the internet, deploy this folder as a Node.js service on a host such as Railway, Render, or another Node-capable provider and attach a managed PostgreSQL database. Set these environment variables in the host dashboard:

- `NODE_ENV=production`
- `DATABASE_URL` (managed PostgreSQL connection string)
- `SESSION_SECRET` (long random secret, 32+ characters)
- `PGSSL=true` if required by the database provider
- `PORT` is normally provided by the host

Use HTTPS. Configure database backups and restore tests before storing real school records. Do not place secrets in frontend files or commit `.env` to Git. Run `npm run check` before deployment.

## Roles

- **ADMIN**: students, marks, payments, reports, users and archive actions.
- **TEACHER**: student records and marks.
- **BURSAR**: payments and payment history.

## Important pre-commercial checklist

Before selling this as a production service, test the full flows against a real hosted PostgreSQL database; add school-specific password recovery and email verification; establish a privacy policy and terms; test restore from backups; review local data-protection requirements; and arrange monitoring and support. Do not use real student data until your hosting and security settings have been reviewed.
