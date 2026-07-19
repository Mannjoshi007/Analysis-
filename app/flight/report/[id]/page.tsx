import { getFlightSession } from '@/lib/supabase-flight'
import type { Metadata } from 'next'
import Link from 'next/link'
import SharedFlightReportClient from './SharedFlightReportClient'

interface Props { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const session = await getFlightSession(id)
  if (!session) return { title: 'Flight Report Not Found — KC DAQ' }
  return {
    title: `${session.name} — KC DAQ Flight Report`,
    description: `Apogee ${session.apogee_m?.toFixed(1)} m · Max climb ${session.max_climb_rate?.toFixed(1)} m/s · Descent ${session.descent_verdict}`,
  }
}

export default async function FlightReportPage({ params }: Props) {
  const { id } = await params
  const session = await getFlightSession(id)

  if (!session) {
    return (
      <>
        <div className="hdr">
          <div className="hdr-left"><Link href="/flight" className="logo">🪂 KC DAQ <span>Flight Analysis</span></Link></div>
        </div>
        <div className="empty" style={{ paddingTop: '80px' }}>
          <div className="empty-icon">❌</div>
          <h3>Flight report not found</h3>
          <p>This flight session does not exist or has been deleted.</p>
          <br /><Link href="/flight" className="btn primary" style={{ marginTop: '8px' }}>← Back to Flight History</Link>
        </div>
      </>
    )
  }

  return <SharedFlightReportClient session={session} />
}
