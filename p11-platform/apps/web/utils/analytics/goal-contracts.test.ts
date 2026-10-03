import { describe, it, expect } from 'vitest';
import { goalCommand, goalValues, goalRead } from './goal-contracts';
import { goalProgress, goalReportValue } from './goal-comparison';
const values = { metric: 'conversions', period: 'quarterly', target: 0.125, direction: 'at_least', threshold: 80 };
const id = '33333333-3333-3333-3333-333333333333';
describe('goal boundaries', () => {
    it.each(['daily', 'weekly', 'monthly', 'quarterly', 'yearly'])('supports %s without coercing targets', period => expect(goalValues.safeParse({ ...values, period }).success).toBe(true));
    it.each([{ target: 0 }, { target: -1 }, { target: NaN }, { target: Infinity }, { target: 1e13 }, { target: '100' }, { metric: 'ctr', target: 101 }, { metric: 'clicks', target: .5 }, { metric: 'impressions', target: .5 }, { direction: null }, { threshold: 0 }, { threshold: 101 }, { threshold: 80.5 }, { period: 'forever' }, { extra: 1 }])('rejects misleading target %j', override => expect(goalValues.safeParse({ ...values, ...override }).success).toBe(false));
    it('binds actor, property, request and current goal revision', () => { const c = { ...values, propertyId: id, expectedActorId: id, id, goalId: id, expectedRevision: 0, operation: 'save' }; expect(goalCommand.safeParse(c).success).toBe(true); expect(goalCommand.safeParse({ ...c, expectedRevision: -1 }).success).toBe(false); expect(goalCommand.safeParse({ ...c, expectedActorId: undefined }).success).toBe(false); });
    it('requires command identity and bounded pages', () => { expect(goalRead.safeParse({ propertyId: id, kind: 'command' }).success).toBe(false); expect(goalRead.safeParse({ propertyId: id, offset: '-1' }).success).toBe(false); });
    it.each([['daily', '2026-09-23', '2026-09-23'], ['weekly', '2025-12-29', '2026-01-04'], ['monthly', '2024-02-01', '2024-02-29'], ['quarterly', '2026-10-01', '2026-12-31'], ['yearly', '2024-01-01', '2024-12-31']])('compares full UTC %s', (period, start, end) => expect(goalReportValue(2, period, { start, end }, false, true)).toBe(2));
    it.each([['daily', '2026-09-22', '2026-09-23'], ['weekly', '2026-09-21', '2026-09-25'], ['weekly', '2026-09-20', '2026-09-26'], ['monthly', '2026-02-01', '2026-02-30']])('withholds incomplete or invalid %s', (period, start, end) => expect(goalReportValue(2, period, { start, end }, false, true)).toBeNull());
    it('does not turn missing values into zero', () => { for (const v of [null, undefined, Infinity, NaN])
        expect(goalReportValue(v, 'daily', { start: '2026-09-23', end: '2026-09-23' }, false, true)).toBeNull(); expect(goalProgress(null, 100, false, 80)).toBeNull(); });
    it('uses explicit direction, with zero meeting a maximum', () => { expect(goalProgress(0, 100, true, 80)).toEqual({ achieved: true, percent: 100, warning: false }); expect(goalProgress(125, 100, true, 80)).toEqual({ achieved: false, percent: 80, warning: false }); expect(goalProgress(126, 100, true, 80)?.warning).toBe(true); expect(goalProgress(79, 100, false, 80)?.warning).toBe(true); expect(goalProgress(100, 100, false, 80)?.achieved).toBe(true); expect(goalProgress(10, 0, false, 80)).toBeNull(); });
});
