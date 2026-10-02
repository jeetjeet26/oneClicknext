import {it,expect,vi} from 'vitest'
vi.mock('@/utils/knowledge/fact-store',()=>({factActor:vi.fn(),readFacts:vi.fn(),decideFacts:vi.fn(),FactError:class extends Error{}}))
import {GET,POST,PATCH} from './route'
import {GET as readFacts,POST as recordedDecision} from '../assistant-facts/route'
it('all compatibility paths use the recorded facts contracts',()=>{expect(GET).toBe(readFacts);expect(POST).toBe(recordedDecision);expect(PATCH).toBe(recordedDecision)})
