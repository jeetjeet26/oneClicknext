import { createServiceClient } from '@/utils/supabase/admin'
import type { Json } from '@/types/supabase'
import type { MeasurementRead } from './measurement-source'
export async function readMeasurements(actorId: string, propertyId: string, input: Record<string, Json>): Promise<MeasurementRead> {
  const client = createServiceClient()
  const { data, error } = await (client.rpc as unknown as (name: string, args: Record<string, Json>) => Promise<{data: Json; error: {message: string} | null}>)('read_geo_measurements', {p_actor_id: actorId, p_property_id: propertyId, p_input: input})
  if (error) throw new Error('Unable to read retained audit measurements')
  return data as unknown as MeasurementRead
}
