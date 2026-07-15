// ─────────────────────────────────────────────────────────────────────────────
// Kratu — Allowed Users Configuration
// Add or remove users here. Each user gets their own email + password.
// NEVER commit this file to a public repository if passwords are sensitive.
// ─────────────────────────────────────────────────────────────────────────────

export interface User {
  email: string
  password: string
  name: string  // Display name shown after login
}

export const ALLOWED_USERS: User[] = [
  // ── Add your users below ─────────────────────────────────────────────────
  { email: 'admin@kailashcosmos.com',      password: 'KC@Admin2026',  name: 'Admin'     },
  { email: 'engg@kailashcosmos.com',       password: 'KC#Engg7742',   name: 'Engineering' },
  { email: 'marketing@kailashcosmos.com',  password: 'KC#Mktg3391',   name: 'Marketing' },
  // { email: 'user@example.com',          password: 'pass',          name: 'Name'      },
  // ─────────────────────────────────────────────────────────────────────────
]
