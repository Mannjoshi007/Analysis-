import { supabase } from './supabase'

// ─── Types ───────────────────────────────────────────────────────────────────
// Separate table (flight_sessions) from the static-test table (test_sessions).
// Uses the same Supabase project/client — no changes to lib/supabase.ts.

export interface FlightSession {
  id: string
  created_at: string
  name: string
  filename: string
  is_public: boolean
  apogee_m: number
  max_climb_rate: number
  max_descent_rate: number
  max_accel_g: number
  deploy_alt_m: number
  flight_duration: number
  sample_rate: number
  total_samples: number
  descent_verdict: string
  stats: Record<string, unknown>
  raw_data: Array<Record<string, unknown>>
}

// ─── DB Operations ───────────────────────────────────────────────────────────

export async function saveFlightSession(
  name: string,
  filename: string,
  stats: Record<string, unknown>,
  rawData: Array<Record<string, unknown>>
): Promise<{ id: string } | null> {
  const s = stats as {
    apogee: number
    maxClimbRate: number
    maxDescentRate: number
    maxAccel: number
    deployAlt: number
    flightDuration: number
    sampleRateHz: number
    totalSamples: number
    descentVerdict: string
  }

  const { data, error } = await supabase
    .from('flight_sessions')
    .insert({
      name,
      filename,
      is_public: true,
      apogee_m: s.apogee,
      max_climb_rate: s.maxClimbRate,
      max_descent_rate: s.maxDescentRate,
      max_accel_g: s.maxAccel,
      deploy_alt_m: s.deployAlt,
      flight_duration: s.flightDuration,
      sample_rate: s.sampleRateHz,
      total_samples: s.totalSamples,
      descent_verdict: s.descentVerdict,
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

export async function getFlightSession(id: string): Promise<FlightSession | null> {
  const { data, error } = await supabase
    .from('flight_sessions')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return null
  return data
}

export async function listFlightSessions(): Promise<FlightSession[]> {
  const { data, error } = await supabase
    .from('flight_sessions')
    .select('id, created_at, name, filename, apogee_m, max_climb_rate, max_descent_rate, flight_duration, descent_verdict')
    .order('created_at', { ascending: false })

  if (error) return []
  return (data || []) as unknown as FlightSession[]
}

export async function deleteFlightSession(id: string): Promise<boolean> {
  const { error } = await supabase.from('flight_sessions').delete().eq('id', id)
  return !error
}
