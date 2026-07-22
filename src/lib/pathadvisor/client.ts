const PATHADVISOR_BASE_URL = "https://navigate.ust.hk/path/api/app";

function toQueryString(params: Record<string, string | number | boolean | undefined>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") {
      continue;
    }

    searchParams.set(key, String(value));
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export async function fetchPathAdvisor<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
) {
  const url = `${PATHADVISOR_BASE_URL}${path}${toQueryString(params ?? {})}`;
  const response = await fetch(url, { headers: { accept: "application/json" } });

  if (!response.ok) {
    throw new Error(`Upstream request failed: ${response.status} for ${path}`);
  }

  return (await response.json()) as T;
}
