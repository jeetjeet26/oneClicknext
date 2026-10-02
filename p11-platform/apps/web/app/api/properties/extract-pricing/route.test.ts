import {beforeEach,it,expect,vi} from 'vitest'
const d=vi.hoisted(()=>({actor:vi.fn()}));vi.mock('@/utils/knowledge/inventory',()=>({inventoryActor:d.actor,InventoryError:class extends Error{constructor(message:string,readonly status=503){super(message)}}}))
import {POST} from './route'
import {InventoryError} from '@/utils/knowledge/inventory'
beforeEach(()=>vi.clearAllMocks())
it('requires authentication even though immediate pricing writes are retired',async()=>{d.actor.mockRejectedValue(new InventoryError('Unauthorized',401));expect((await POST()).status).toBe(401)})
it('directs authenticated callers to reviewed facts without processing input',async()=>{d.actor.mockResolvedValue('actor');const response=await POST();expect(response.status).toBe(410);expect(response.headers.get('Cache-Control')).toBe('private, no-store');expect(await response.json()).toEqual({error:expect.stringContaining('reviewed floor-plan editor')})})
