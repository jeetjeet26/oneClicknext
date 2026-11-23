/** Shared deployment credentials may only be used for account discovery and
 * provisioning by explicitly configured platform operators, never a tenant role alone. */
export function isPlatformOperator(userId: string, role: string | null | undefined): boolean {
  if (role !== 'admin' || !userId) return false
  const operators = (process.env.P11_OPERATIONS_ADMIN_IDS || '')
    .split(',').map(id => id.trim()).filter(Boolean)
  return operators.includes(userId)
}
