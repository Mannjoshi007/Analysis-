import { NextResponse } from 'next/server'
import { ALLOWED_USERS } from '@/lib/users'

// POST /api/auth — validate credentials and set auth cookie
export async function POST(req: Request) {
  try {
    const { email, password } = await req.json()
    const user = ALLOWED_USERS.find(
      u => u.email.toLowerCase() === email.toLowerCase() && u.password === password
    )
    if (!user) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }
    const token = Buffer.from(JSON.stringify({ email: user.email, name: user.name })).toString('base64')
    const res = NextResponse.json({ ok: true, name: user.name })
    res.cookies.set('kratu_auth', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    })
    return res
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
}

// DELETE /api/auth — clear auth cookie (logout)
export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set('kratu_auth', '', { maxAge: 0, path: '/' })
  return res
}
