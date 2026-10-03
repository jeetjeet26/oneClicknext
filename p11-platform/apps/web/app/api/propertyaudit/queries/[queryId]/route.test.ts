import { describe, it, expect, vi } from 'vitest';
import { PATCH, DELETE } from './route';
describe('retired unrecorded audit writes', () => { it.each([PATCH, DELETE])('holds the legacy write without sending provider requests', async (operation) => { const network = vi.spyOn(globalThis, 'fetch'); const r = await operation(); expect(r.status).toBe(410); expect((await r.json()).error).toContain('reviewed audit decisions'); expect(network).not.toHaveBeenCalled(); network.mockRestore(); }); });
