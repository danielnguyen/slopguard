export function heuristicScore(title: string, description: string): number {
  let score = 0;

  const lower = (title + ' ' + description).toLowerCase();

  if (lower.includes("they don't want you to know")) score += 20;
  if (lower.includes("shocking") || lower.includes("exposed")) score += 15;
  if (lower.includes("breaking") && lower.includes("truth")) score += 10;

  if (!description.includes("http")) score += 15;

  if (lower.includes("geopolitics") || lower.includes("world order")) score += 10;

  return score;
}
