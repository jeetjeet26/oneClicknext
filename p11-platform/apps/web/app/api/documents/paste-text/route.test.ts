import {it,expect,vi} from 'vitest'
vi.mock('@/utils/knowledge/material-store',()=>({materialActor:vi.fn(),readMaterials:vi.fn(),decideMaterial:vi.fn(),knowledgeExecutionStatus:vi.fn(),MaterialError:class extends Error{}}))
import {POST} from './route'
import {POST as recordedPost} from '../../knowledge/materials/route'
it('legacy paste uses the strict recorded decision handler, with no separate embedding path',()=>expect(POST).toBe(recordedPost))
