export async function apiRequest(path, { token, ...options } = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new Error("Cannot reach the PayApp server. Start it with npm run dev, then try again.");
  }

  const body = await response.text();
  let result;
  try {
    result = body ? JSON.parse(body) : {};
  } catch {
    result = {};
  }
  if (!response.ok) {
    const message = typeof result.error === "string" ? result.error : null;
    if (response.status === 404) {
      throw new Error(message || "PayApp could not find that API endpoint. Restart the server and try again.");
    }
    if (response.status === 502 || response.status === 503) {
      throw new Error(message || "PayApp is temporarily unavailable. Check that the server and database are running.");
    }
    throw new Error(message || `PayApp could not complete the request (HTTP ${response.status}).`);
  }
  return result;
}
