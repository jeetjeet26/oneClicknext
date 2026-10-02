import {z} from 'zod'
import {propertyIdSchema as id} from '@/utils/property-setup/contracts'
export const crawlReceiptRead=z.object({propertyId:id,crawlId:id,id:id.optional(),offset:z.coerce.number().int().min(0).max(1000000).default(0),hash:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict()
