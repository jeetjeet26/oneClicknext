import { describe, it, expect } from 'vitest';
import { scheduleConfig, scheduleCommand, scheduleRead, pendingSchedule } from './schedule-contracts';
const config = { name: 'Weekly', frequency: 'weekly', weekday: 1, monthday: null, hour: 9, window: 'last_7_days', comparison: true, campaigns: true, recipients: [' A@Example.test '] };
const id = '11111111-1111-1111-1111-111111111111';
describe('report schedule contracts', () => {
    it('normalizes recipients and preserves generic UUIDs', () => { expect(scheduleConfig.parse(config).recipients).toEqual(['a@example.test']); expect(scheduleCommand.safeParse({ operation: 'create', id, propertyId: id, expectedActorId: id, config }).success).toBe(true); });
    it.each([{ hour: 24 }, { hour: '9' }, { weekday: null }, { monthday: 1 }, { frequency: null }, { window: 'live' }, { name: 'subject\nheader' }, { recipients: [] }, { recipients: ['a@x.test', 'A@x.test'] }, { recipients: ['a@x.test\nBcc:x@y.test'] }, { recipients: Array.from({ length: 11 }, (_, i) => i + '@x.test') }, { report_type: 'leads' }])('rejects unsupported schedule %j', change => expect(scheduleConfig.safeParse({ ...config, ...change }).success).toBe(false));
    it('requires current revision for changes', () => expect(scheduleCommand.safeParse({ operation: 'pause', id, propertyId: id, expectedActorId: id, scheduleId: id }).success).toBe(false));
    it('rejects forged provider status and unbounded history', () => { expect(scheduleCommand.safeParse({ operation: 'delivered', id, propertyId: id, expectedActorId: id }).success).toBe(false); expect(scheduleRead.safeParse({ propertyId: id, kind: 'run' }).success).toBe(false); expect(scheduleRead.safeParse({ propertyId: id, offset: -1 }).success).toBe(false); });
    it('browser recovery stores only request identity', () => { expect(pendingSchedule.parse({ id })).toEqual({ id }); expect(pendingSchedule.safeParse({ id, recipients: ['a@x.test'] }).success).toBe(false); });
});
