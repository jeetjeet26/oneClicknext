import {expect,it} from 'vitest'
import {POST,GET} from './route'
import {POST as savedPost,GET as savedGet} from '../intake/route'
it('uses only the strict saved-import contract',()=>{expect(POST).toBe(savedPost);expect(GET).toBe(savedGet)})
