import {it,expect,vi} from 'vitest'
vi.mock('@/utils/knowledge/file-store',()=>({fileActor:vi.fn(),readFiles:vi.fn(),decideFile:vi.fn(),uploadOriginal:vi.fn(),FileError:class extends Error{}}))
import {POST} from './route'
import {POST as savedPOST} from '../../knowledge/files/route'
it('old upload entry point uses the recorded private-file workflow',()=>expect(POST).toBe(savedPOST))
