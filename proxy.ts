import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/api/auth']

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p))
  const auth = request.cookies.get('kratu_auth')?.value

  // Not logged in → redirect to login (except public paths)
  if (!auth && !isPublic) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Already logged in → redirect away from login page
  if (auth && pathname === '/login') {
    return NextResponse.redirect(new URL('/analyze', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|kailash-cosmos-logo\\.jpg).*)',
  ],
}
