import { getSession } from '@/lib/supabase'
import type { Metadata } from 'next'
import Link from 'next/link'
import SharedReportClient from './SharedReportClient'

interface Props { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const session = await getSession(id)
  if (!session) return { title: 'Report Not Found — KC DAQ' }
  return {
    title: `${session.name} — KC DAQ Motor Report`,
    description: `${session.motor_class}-class motor · ${session.total_impulse?.toFixed(2)} N·s impulse · ${session.peak_thrust?.toFixed(1)} N peak thrust`,
  }
}

export default async function ReportPage({ params }: Props) {
  const { id } = await params
  const session = await getSession(id)

  if (!session) {
    return (
      <>
        <div className="hdr">
          <div className="hdr-left"><Link href="/" className="logo">🚀 KC DAQ <span>Motor Analysis</span></Link></div>
        </div>
        <div className="empty" style={{ paddingTop: '80px' }}>
          <div className="empty-icon">❌</div>
          <h3>Report not found</h3>
          <p>This test session does not exist or has been deleted.</p>
          <br /><Link href="/" className="btn primary" style={{ marginTop: '8px' }}>← Back to History</Link>
        </div>
      </>
    )
  }

  return <SharedReportClient session={session} />
}
