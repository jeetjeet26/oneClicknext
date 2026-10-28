import { decisionNote } from '@/utils/actions/decision-note'
import {z} from 'zod'
import {responseIdSchema} from './response-contracts'
export const configurationReadSchema=z.object({propertyId:responseIdSchema,cursor:responseIdSchema.optional()}).strict()
export const configurationWriteSchema=z.object({propertyId:responseIdSchema,requestId:responseIdSchema,expectedVersion:z.number().int().min(0),defaultTone:z.enum(['professional','empathetic','friendly','apologetic']),propertyPersonality:z.string().trim().max(2000),reason:decisionNote(2000, 3)}).strict()
