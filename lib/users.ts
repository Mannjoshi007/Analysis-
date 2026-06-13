// ─────────────────────────────────────────────────────────────────────────────
// KC DAQ — Allowed Users Configuration
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
  { email: 'admin@kailashcosmos.com',  password: 'KC@Admin2026',  name: 'Admin' },
  // { email: 'user2@example.com',     password: 'pass2',         name: 'User 2' },
  // { email: 'user3@example.com',     password: 'pass3',         name: 'User 3' },
  // ─────────────────────────────────────────────────────────────────────────
]
