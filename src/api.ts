export class ApiError extends Error {
  status: number;
  details?: Record<string, string[]>;
  constructor(message: string, status: number, details?: Record<string, string[]>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method, credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(data?.error ?? "Something went wrong. Please try again.", response.status, data?.details);
  return data as T;
}

export const get = <T = any>(path: string) => api<T>("GET", path);
export const post = <T = any>(path: string, body?: unknown) => api<T>("POST", path, body ?? {});
export const put = <T = any>(path: string, body: unknown) => api<T>("PUT", path, body);
export const patch = <T = any>(path: string, body: unknown) => api<T>("PATCH", path, body);
export const del = <T = any>(path: string, body?: unknown) => api<T>("DELETE", path, body);

export const errorMessage = (error: unknown) => {
  if (error instanceof ApiError) {
    const first = error.details && Object.entries(error.details).find(([, v]) => v?.length);
    return first ? `${error.message} (${first[0]}: ${first[1][0]})` : error.message;
  }
  return "Something went wrong. Please try again.";
};
