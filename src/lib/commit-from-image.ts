export function commitFromImage(image: string | null | undefined): string | null {
  if (!image) return null;
  const slash = image.lastIndexOf("/");
  const colon = image.lastIndexOf(":");
  if (colon <= slash) return null;

  const tag = image.slice(colon + 1).split("@")[0];
  const nightlyMatch = tag.match(/^nightly-([0-9a-f]{7,40})(?:[-_.].*)?$/i);
  if (nightlyMatch) return nightlyMatch[1];

  const shaMatch = tag.match(/(?:^|[-_.])([0-9a-f]{12,40})(?:$|[-_.])/i);
  return shaMatch?.[1] ?? null;
}
