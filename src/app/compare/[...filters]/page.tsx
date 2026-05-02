import { redirect } from "next/navigation";

type SearchParamValue = string | string[] | undefined;

interface CompareRedirectPageProps {
  params: Promise<{ filters?: string[] }>;
  searchParams: Promise<Record<string, SearchParamValue>>;
}

function addSearchParam(
  params: URLSearchParams,
  key: string,
  value: SearchParamValue
) {
  if (Array.isArray(value)) {
    for (const item of value) params.append(key, item);
    return;
  }

  if (value !== undefined) params.set(key, value);
}

export default async function CompareRedirectPage({
  params,
  searchParams,
}: CompareRedirectPageProps) {
  const [{ filters = [] }, query] = await Promise.all([params, searchParams]);
  const nextParams = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    addSearchParam(nextParams, key, value);
  }

  for (const segment of filters) {
    const decodedSegment = decodeURIComponent(segment);
    const separatorIndex = decodedSegment.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = decodedSegment.slice(0, separatorIndex);
    const value = decodedSegment.slice(separatorIndex + 1);
    if (!nextParams.has(key)) nextParams.set(key, value);
  }

  const queryString = nextParams.toString();
  redirect(queryString ? `/compare?${queryString}` : "/compare");
}
