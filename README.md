# Sales AI Agent (Next.js + PostgreSQL + Prisma)

Public test web app that shows inventory, builds a cart, and creates preliminary orders (auto-incrementing order number).

## What's included

- Inventory list + search
- Cart (quantities)
- Preliminary order creation (customer name, contact, ship-to, preferred delivery date, optional PO number)
- Checkout page: **sales rep name + email** — saves to the order and **emails** a preliminary-order summary via SMTP (see **Email** below)
- AI chat endpoint (placeholders until you provide the OpenAI API key and your real Excel inventory mapping)

## Setup

1. Install Node.js (LTS) and ensure `node`/`npm` are in your PATH.
2. Create a **PostgreSQL** database (local install, [Neon](https://neon.tech), Supabase, etc.) and copy its connection string.
3. In this folder, run:
   - `npm install`
   - Copy `.env.example` to `.env`, set `DATABASE_URL` (PostgreSQL) and `OPENAI_API_KEY`
   - `npm run db:setup` (applies migrations + seeds sample inventory)
4. Start the app:
   - `npm run dev`

**Company logo (PDF + header):** place `public/company-logo.png` in the repo, or set `COMPANY_LOGO_PATH` to an absolute path on the server.

## Deploying on Vercel

1. Push this repo to GitHub and import the project in [Vercel](https://vercel.com).
2. Add environment variables in the Vercel project (at minimum `DATABASE_URL`, `OPENAI_API_KEY`; add email/Oracle vars if you use them).
3. `vercel.json` sets **Build Command** to `npm run build:vercel`, which runs `prisma migrate deploy` then `next build`, so the database schema stays in sync on each production deploy.
4. Use a **pooled** Postgres URL if your provider recommends it for serverless (e.g. Neon’s pooled connection string with `sslmode=require`).
5. **Excel COM prefill** (`ORACLE_TEMPLATE_PREFILL=true`) does not run on Vercel; use `false` and attach the original template or CSV-only email mode.

SMTP from Vercel’s cloud to an **internal relay IP** often fails unless the network allows it; for an executive demo, test email from the deployed URL or use a public SMTP/API provider.

## Inventory import

Upload `.xls` exports from Oracle BI Publisher (HTML table) via the admin import UI (password in app). Implementation: `src/app/api/inventory/import/route.ts` and `src/lib/inventoryImport.ts`.

## Email (preliminary order to sales rep)

On checkout, saving **sales rep name + email** sends a plain-text + HTML summary via **Nodemailer**, with:

- **`PreliminaryOrder_<n>_OracleImport.csv`** — spreadsheet-friendly export (`src/lib/oracleOrderCsv.ts`).
- Optional prefilled **`PreliminaryOrder_<n>_OrderTemplate.xlsm`** if `ORACLE_ORDER_TEMPLATE_PATH` points to your macro template (`src/lib/oracleTemplateWorkbook.ts`) **and** `ORACLE_ATTACH_TEMPLATE_EMAIL=true`.

SMTP configuration:

- `EMAIL_SMTP_HOST` — e.g. internal relay `10.182.1.25`
- `EMAIL_SMTP_PORT` — e.g. `25`
- `EMAIL_FROM` — e.g. `BINoReply@everde.com`
- `EMAIL_SMTP_SECURE` — `false` for plain port 25
- Optional: `EMAIL_SMTP_USER` / `EMAIL_SMTP_PASS` if the relay requires auth
- **IP as SMTP host:** If `EMAIL_SMTP_HOST` is an IPv4/IPv6 address, TLS hostname verification is **skipped by default** (Exchange certs usually don’t list the IP in SANs). Set `EMAIL_SMTP_TLS_STRICT=true` to enforce verification, or use `EMAIL_SMTP_TLS_SERVERNAME` with the mail server’s DNS name if you prefer verified TLS while still connecting to an IP.
- Optional: `EMAIL_SMTP_TLS_REJECT_UNAUTHORIZED=false` to always skip cert verification (even when using a hostname)
- Optional: `ORACLE_ORDER_TEMPLATE_PATH` for generating a prefilled macro workbook copy
- Optional: `ORACLE_ATTACH_TEMPLATE_EMAIL=true` to include that `.xlsm` in email (default is off to avoid SMTP size errors)

The app server must reach the SMTP host (same network/VPN as your Outlook relay).

### Web ADI (Excel → Oracle)

Checkout includes **download links** for CSV / `.dat`. For **Oracle Web ADI**, use **Download CSV (Excel / Web ADI)** and follow **`docs/WEB_ADI_EBS.md`** — ADI itself is configured in EBS; Everde supplies a paste-friendly file.

## Troubleshooting (Windows)

- **`Unknown argument 'contact'`** (or other new fields): The database schema is updated but the **generated Prisma Client is stale**. Stop the dev server (`Ctrl+C`), then run `npx prisma generate`. If you see **`EPERM ... rename ... query_engine-windows.dll.node`**, another process (often `node` from `npm run dev`) is locking the file—stop it, optionally delete `node_modules\.prisma\client\query_engine-windows.dll.node`, then run `npx prisma generate` again.

