function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2)
}

function shingles(value: string, width = 2): Set<string> {
  const words = tokens(value)
  if (words.length < width) return new Set(words)
  return new Set(
    words.slice(0, words.length - width + 1).map((_, index) =>
      words.slice(index, index + width).join(' ')
    )
  )
}

export function jaccardCopySimilarity(left: string, right: string): number {
  const a = shingles(left)
  const b = shingles(right)
  if (a.size === 0 && b.size === 0) return 1
  const intersection = [...a].filter(value => b.has(value)).length
  const union = new Set([...a, ...b]).size
  return Math.round((intersection / Math.max(1, union)) * 1000) / 1000
}

export function findRepeatedCopy(
  sections: Array<{ id: string; headline: string; copy: string }>,
  threshold = 0.58
): Array<{ left: string; right: string; similarity: number }> {
  const matches: Array<{ left: string; right: string; similarity: number }> = []
  for (let left = 0; left < sections.length; left += 1) {
    for (let right = left + 1; right < sections.length; right += 1) {
      const similarity = jaccardCopySimilarity(
        `${sections[left].headline} ${sections[left].copy}`,
        `${sections[right].headline} ${sections[right].copy}`
      )
      if (similarity >= threshold) {
        matches.push({
          left: sections[left].id,
          right: sections[right].id,
          similarity,
        })
      }
    }
  }
  return matches.sort(
    (a, b) =>
      b.similarity - a.similarity ||
      `${a.left}:${a.right}`.localeCompare(`${b.left}:${b.right}`)
  )
}
