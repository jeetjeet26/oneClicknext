type ConversationMessage = { role: string; content: string }

const EMAIL = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
const PHONE = /(?<![\w\d])\+?\d[\d(). -]{5,}\d(?![\w\d])/g

function phoneIdentity(value: string): string | null {
  if (!/^\+?[\d().\s-]+$/.test(value.trim())) return null
  const digits = value.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return null
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

/** Model output may only propose contact details present in saved visitor text. */
export function groundVisitorContact(
  extracted: { email?: unknown; phone?: unknown } | null | undefined,
  messages: ConversationMessage[],
): { email: string | null; phone: string | null } {
  const visitorMessages = messages.filter(message => message.role === 'user')
  const emails = new Set(visitorMessages.flatMap(message =>
    (message.content.match(EMAIL) ?? []).map(value => value.toLowerCase()),
  ))
  const phones = new Set(visitorMessages.flatMap(message =>
    (message.content.match(PHONE) ?? []).map(phoneIdentity).filter(Boolean),
  ))
  const email = typeof extracted?.email === 'string' ? extracted.email.trim() : null
  const phone = typeof extracted?.phone === 'string' ? extracted.phone.trim() : null
  const identity = phone ? phoneIdentity(phone) : null
  return {
    email: email && emails.has(email.toLowerCase()) ? email : null,
    phone: phone && identity && phones.has(identity) ? phone : null,
  }
}
