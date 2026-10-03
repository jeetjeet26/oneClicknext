export async function completeAuditRows<T>(read: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: {
        message: string;
    } | null;
}>): Promise<T[]> {
    const rows: T[] = [];
    for (;;) {
        const result = await read(rows.length, rows.length + 499);
        if (result.error)
            throw new Error(result.error.message);
        const batch = result.data || [];
        rows.push(...batch);
        if (batch.length < 500)
            return rows;
    }
}
