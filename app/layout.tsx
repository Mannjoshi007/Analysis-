import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Kratu — Motor Analysis Platform',
  description: 'Analyze and report solid-fuel rocket motor test data — Kratu by Kailash Cosmos.',
  keywords: ['rocket motor', 'thrust curve', 'DAQ', 'motor analysis', 'KNDX', 'solid fuel'],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  )
}
