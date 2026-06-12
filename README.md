# KC DAQ — Motor Analysis Platform

A web app for analyzing solid-fuel rocket motor test data from KC DAQ CSV files.
Built with Next.js, Supabase, and deployed on Vercel.

## Features

- 📊 Full thrust curve analysis (Dashboard, Charts, Analysis, Pressure, Report, Calculator tabs)
- ☁ Save test sessions to Supabase cloud
- 🔗 Shareable public report URLs
- 📋 History gallery of all saved tests

## Stack

- **Framework**: Next.js 16 (App Router)
- **Database**: Supabase (PostgreSQL)
- **Deployment**: Vercel
- **Charts**: Chart.js

## Environment Variables

Create a `.env.local` file (never commit this):

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)
