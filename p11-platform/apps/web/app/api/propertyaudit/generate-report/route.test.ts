import { describe, it, expect } from 'vitest';
import { POST } from './route';
describe('retired unrecorded audit exports', () => { it('directs callers to retained reports without a provider call', async () => { const response = await POST(); expect(response.status).toBe(410); expect((await response.json()).error).toContain('retained evidence'); }); });
