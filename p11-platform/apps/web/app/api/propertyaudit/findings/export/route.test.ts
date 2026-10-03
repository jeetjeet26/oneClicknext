import { describe, it, expect } from 'vitest';
import { GET } from './route';
describe('retired unrecorded audit exports', () => { it('directs callers to retained reports without a provider call', async () => { const response = await GET(); expect(response.status).toBe(410); expect((await response.json()).error).toContain('retained evidence'); }); });
