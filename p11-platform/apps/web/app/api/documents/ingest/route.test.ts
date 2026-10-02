import {beforeEach,it,expect,vi} from 'vitest'
const actor=vi.hoisted(()=>vi.fn())
vi.mock('@/utils/knowledge/inventory',()=>({inventoryActor:actor,InventoryError:class extends Error{constructor(message:string,readonly status=503){super(message)}}}))
import {POST} from './route'
import {InventoryError} from '@/utils/knowledge/inventory'
beforeEach(()=>vi.clearAllMocks())
it('requires authentication before disclosing the retired workflow',async()=>{actor.mockRejectedValue(new InventoryError('Unauthorized',401));expect((await POST()).status).toBe(401)})
it('retires arbitrary metadata ingestion without any model or database mutation',async()=>{actor.mockResolvedValue('actor');expect((await POST()).status).toBe(410)})
