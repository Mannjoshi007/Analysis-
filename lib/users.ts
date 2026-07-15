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
  { email: 'mann@kailashcosmos.com',      password: 'mann07',  name: 'Joshi Mann'     },
  { email: 'harsh.engg@kailashcosmos.com',       password: 'harsh25',   name: 'Patel Harsh' },
  { email: 'pruthav.sales@kailashcosmos.com',  password: 'pruthav26',   name: 'Pandya Pruthav' },
  { email: 'prince.marketing@kailashcosmos.com',      password: 'prince25',  name: 'Panchal Prince'     },
  { email: 'yash.media@kailashcosmos.com',       password: 'yash26',   name: 'Patidar Yash' },
  // { email: 'user@example.com',          password: 'pass',          name: 'Name'      },
  // ─────────────────────────────────────────────────────────────────────────
]
