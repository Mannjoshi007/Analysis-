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
  { email: 'mann@kailashcosmos.com',      password: 'KC@Admin2026',  name: 'Mann'     },
  { email: 'harsh.engg@kailashcosmos.com',       password: 'KC#Engg7742',   name: 'Harsh25' },
  { email: 'pruthav.sales@kailashcosmos.com',  password: 'KC#Mktg3391',   name: 'Pruthav26' },
  { email: 'prince.marketing@kailashcosmos.com',      password: 'KC@Admin2026',  name: 'Prince25'     },
  { email: 'yash.media@kailashcosmos.com',       password: 'KC#Engg7742',   name: 'Yash26' },
  // { email: 'user@example.com',          password: 'pass',          name: 'Name'      },
  // ─────────────────────────────────────────────────────────────────────────
]
