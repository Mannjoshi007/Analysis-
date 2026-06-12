import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TestSession {
  id: string
  created_at: string
  name: string
  filename: string
  is_public: boolean
  motor_class: string
  total_impulse: number
  peak_thrust: number
  avg_thrust: number
  burn_time: number
  avg_temp: number
  isp: number
  sample_rate: number
  burn_samples: number
  total_samples: number
  profile_type: string
  snr_db: number
  stats: Record<string, unknown>
  raw_data: Array<Record<string, number>>
}

// ─── DB Operations ───────────────────────────────────────────────────────────

export async function saveSession(
  name: string,
  filename: string,
  stats: Record<string, unknown>,
  rawData: Array<Record<string, number>>
): Promise<{ id: string } | null> {
  const s = stats as {
    motorClass: string
    totalImpulse: number
    peak: number
    avgThrust: number
    burnTime5: number
    avgTemp: number
    isp: number
    sampleRate: number
    burnSamples: number
    totalSamples: number
    profileType: string
    snrDb: number
  }

  const { data, error } = await supabase
    .from('test_sessions')
    .insert({
      name,
      filename,
      is_public: true,
      motor_class: s.motorClass,
      total_impulse: s.totalImpulse,
      peak_thrust: s.peak,
      avg_thrust: s.avgThrust,
      burn_time: s.burnTime5,
      avg_temp: s.avgTemp,
      isp: s.isp,
      sample_rate: s.sampleRate,
      burn_samples: s.burnSamples,
      total_samples: s.totalSamples,
      profile_type: s.profileType,
      snr_db: s.snrDb,
      stats,
      raw_data: rawData,
    })
    .select('id')
    .single()

  if (error) {
    console.error('Save error:', error)
    return null
  }
  return data
}

export async function getSession(id: string): Promise<TestSession | null> {
  const { data, error } = await supabase
    .from('test_sessions')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return null
  return data
}

export async function listSessions(): Promise<TestSession[]> {
  const { data, error } = await supabase
    .from('test_sessions')
    .select('id, created_at, name, filename, motor_class, total_impulse, peak_thrust, burn_time, avg_temp, profile_type')
    .order('created_at', { ascending: false })

  if (error) return []
  return (data || []) as unknown as TestSession[]
}

export async function deleteSession(id: string): Promise<boolean> {
  const { error } = await supabase.from('test_sessions').delete().eq('id', id)
  return !error
}
