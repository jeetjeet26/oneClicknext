import type { Portfolio } from "./portfolio";
export function answerPortfolioQuestion(question: string, data: Portfolio) {
  const q = question.toLowerCase().trim();
  if (/last month|last week|last year|yesterday/.test(q))
    return {
      supported: false,
      answer: [
        "Set the reporting dates to the period you mean, then ask again. Answers use the dates shown above.",
      ],
      evidence: [],
    };
  if (!q || q.length > 2000)
    throw new Error("Ask a question in 2,000 characters or fewer.");
  const named = data.properties.filter((p) =>
    q.includes(p.score.name.toLowerCase()),
  );
  const selected = named.length ? named : data.properties;
  let answer: string[] = [];
  let supported = true;
  if (/budget|move.*\$|allocate|predict|forecast|cause|caused/.test(q))
    return {
      supported: false,
      answer: [
        "The recorded data does not establish causation or support a reliable budget allocation or forecast. Review the comparison and source coverage before making that decision.",
      ],
      evidence: [],
    };
  if (/coverage|missing|fresh|source|sync/.test(q))
    answer = selected.map(
      (p) =>
        `${p.score.name}: marketing has ${p.score.observedDays}/${p.score.days} days; ${p.coverage.map((c) => `${c.provider}: ${c.status}${c.latest ? " (latest " + c.latest + ")" : ""}`).join("; ")}.`,
    );
  else if (/experiment|test|after.*launch|after.*change/.test(q))
    answer = selected.flatMap((p) =>
      p.experiments.map(
        (e) => `${p.score.name} — ${e.title}: ${e.result}. ${e.limitations}`,
      ),
    );
  else if (/why|drop|decline|change|driver|weak|friction/.test(q))
    answer = selected.flatMap((p) =>
      p.insights.map(
        (i) =>
          `${p.score.name}: ${i.observation} ${i.interpretation} Suggested review: ${i.action}`,
      ),
    );
  else if (
    /which|rank|compare|highest|lowest|most|fewest|performance|summary|tour|lead|inquir|spend|click|lease|application/.test(
      q,
    )
  ) {
    const metric = /tour/.test(q)
      ? "tours"
      : /lease/.test(q)
        ? "leases"
        : /application/.test(q)
          ? "applications"
          : /spend/.test(q)
            ? "spend"
            : /click/.test(q)
              ? "clicks"
              : "inquiries";
    const sorted = [...selected].sort(
      (a, b) => (b.score[metric] ?? -Infinity) - (a.score[metric] ?? -Infinity),
    );
    if (/lowest|fewest/.test(q)) sorted.reverse();
    answer = sorted.map(
      (p) =>
        `${p.score.name}: ${["spend", "clicks"].includes(metric) && p.score.observedDays === 0 ? "unavailable" : (p.score[metric] ?? "unavailable")} recorded ${metric}; ${p.score.observedDays}/${p.score.days} marketing days. Recorded leases reflect reported outcomes, not automatic signature verification.`,
    );
  } else supported = false;
  return {
    supported,
    answer: answer.length
      ? answer
      : [
          supported
            ? "No matching observations are available for this period."
            : "I can compare recorded inquiries, tours, leases, spend and clicks; explain observed changes; and review coverage or experiments.",
        ],
    evidence: selected.map((p) => ({
      propertyId: p.score.id,
      label: p.score.name,
      start: data.start,
      end: data.end,
      generatedAt: data.generatedAt,
    })),
  };
}
