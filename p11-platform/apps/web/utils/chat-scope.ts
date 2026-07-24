const PROPERTY_TOPIC_PATTERNS = [
  /\b(apartment|apartments|unit|units|home|homes|townhome|townhomes|condo|condos|community|property|building|residence|residences)\b/,
  /\b(rent|rental|lease|leasing|availability|available|vacancy|vacancies|move[\s-]?in|deposit|fee|fees|pricing|price|prices|cost|special|specials|concession|floor\s*plan|floorplan|bed|beds|br|brs|bd|bds|bedroom|bedrooms|bath|baths|bathroom|bathrooms|studio|sq\s*ft|square\s*feet)\b/,
  /\b(amenity|amenities|pool|gym|fitness|parking|garage|pet|pets|dog|dogs|cat|cats|laundry|washer|dryer|balcony|patio|rooftop|ev|solar|storage)\b/,
  /\b(tour|tours|showing|showings|visit|appointment|schedule|calendar|book|booking|stop\s*by|come\s*by|open\s*house)\b/,
  /\b(location|located|address|directions|neighborhood|neighbourhood|nearby|school|schools|transit|commute|walk|drive|office\s*hours|hours|contact|phone|email|call|text)\b/,
  /\b(application|apply|applying|qualify|qualification|income|credit|guarantor|cosigner|co-signer|policy|policies|utilities|maintenance|resident|residents)\b/,
]

const CONVERSATIONAL_PATTERNS = [
  /^(hi|hello|hey|good\s+(morning|afternoon|evening)|thanks|thank\s+you|ok|okay|yes|no|sure|sounds\s+good|great|cool|awesome)[\s!.?]*$/i,
  /\b(can|could)\s+you\s+help\b/i,
  /\b(what\s+can\s+you\s+(do|help\s+with)|how\s+can\s+you\s+help)\b/i,
  /\b(my\s+name\s+is|i\s+am|i'm|call\s+me|my\s+email|my\s+phone|reach\s+me)\b/i,
]

const CONTACT_INFO_PATTERNS = [
  /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/,
  /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/,
]

const OFF_TOPIC_PATTERNS = [
  /\b(math|algebra|geometry|calculus|trigonometry|equation|equations|derivative|integral|homework)\b/,
  /\b(code|coding|programming|javascript|typescript|python|java|sql|debug|algorithm|regex)\b/,
  /\b(recipe|cook|cooking|bake|baking|meal|calories|workout|exercise|diet)\b/,
  /\b(history|trivia|politics|religion|horoscope|astrology|sports|movie|movies|song|songs|game|games|joke|jokes)\b/,
  /\b(medical|doctor|diagnose|diagnosis|legal|lawyer|lawsuit|stock|stocks|crypto|investment|investing)\b/,
  /\b(write|draft)\s+(an?\s+)?(essay|poem|story|song|resume|cover\s+letter)\b/,
  /\b(translate|summarize|solve|teach\s+me|explain)\b/,
]

const QUESTION_START_PATTERN = /^(what|who|when|where|why|how|can|could|should|would|is|are|do|does|did)\b/i
const BROAD_PROPERTY_INTENT_PATTERN = /\b(tell|show|describe|overview|summary)\b.*\b(me|us|about|this|it)\b/i

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function mentionsPropertyName(text: string, propertyName?: string | null): boolean {
  const normalizedName = propertyName?.trim().toLowerCase()
  if (!normalizedName) return false

  if (new RegExp(`\\b${escapeRegExp(normalizedName)}\\b`, 'i').test(text)) {
    return true
  }

  const nameWords = normalizedName.match(/[a-z0-9]+/g) || []
  return nameWords
    .filter(word => word.length >= 4)
    .some(word => new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(text))
}

export function containsContactInfo(message: string): boolean {
  const text = message.trim().toLowerCase()
  if (!text) return false
  return CONTACT_INFO_PATTERNS.some(pattern => pattern.test(text))
}

export function buildPropertyOnlyResponse(propertyName: string): string {
  return `I can only help with questions about ${propertyName}, like availability, pricing, amenities, tours, policies, and neighborhood details. What would you like to know about the property?`
}

const TOUR_KEYWORD_PATTERN = /\b(tours?|showings?|visit|appointment|schedule|book|booking|come\s*by|stop\s*by|check\s*out|look\s*at|view|see)\b/i

const TOUR_FOLLOW_UP_AFFIRMATION_PATTERN = /\b(yes|yeah|yep|sure|absolutely|definitely|sounds\s+good|ok(?:ay)?|please|let'?s\s+do\s+(?:it|that)|i(?:'d|\s+would)\s+love\s+to|that\s+works|why\s+not)\b/i

const TOUR_FOLLOW_UP_TIMING_PATTERN = /\b(availability|available|openings?|slots?|times?|when|today|tomorrow|tonight|(?:next|this)\s+(?:week|month|weekend)|weekends?|weekdays?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mornings?|afternoons?|evenings?)\b/i

/**
 * Detects tour intent from the latest visitor message. Direct keywords always
 * count. Affirmations ("I would love to") or scheduling questions ("is there
 * availability next week?") only count as tour intent when the assistant's
 * previous message brought up a tour, so plain availability questions about
 * homes don't open the booking calendar.
 */
export function detectTourIntent(message: string, previousAssistantMessage?: string | null): boolean {
  const text = message.trim().toLowerCase()
  if (!text) return false

  if (TOUR_KEYWORD_PATTERN.test(text)) return true

  const previous = previousAssistantMessage?.trim().toLowerCase()
  if (!previous || !TOUR_KEYWORD_PATTERN.test(previous)) return false

  return TOUR_FOLLOW_UP_AFFIRMATION_PATTERN.test(text) || TOUR_FOLLOW_UP_TIMING_PATTERN.test(text)
}

export function isPropertyChatInScope(message: string, propertyName?: string | null): boolean {
  const text = message.trim().toLowerCase()
  if (!text) return true

  if (mentionsPropertyName(text, propertyName)) {
    return true
  }

  if (PROPERTY_TOPIC_PATTERNS.some(pattern => pattern.test(text))) {
    return true
  }

  if (CONVERSATIONAL_PATTERNS.some(pattern => pattern.test(text))) {
    return true
  }

  if (CONTACT_INFO_PATTERNS.some(pattern => pattern.test(text))) {
    return true
  }

  if (OFF_TOPIC_PATTERNS.some(pattern => pattern.test(text))) {
    return false
  }

  if (BROAD_PROPERTY_INTENT_PATTERN.test(text)) {
    return true
  }

  const words = text.match(/[a-z0-9]+/g) || []
  if (QUESTION_START_PATTERN.test(text) && words.length > 3) {
    return false
  }

  return words.length <= 3
}
