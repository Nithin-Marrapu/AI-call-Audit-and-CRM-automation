async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON (server down, proxy error)
  }
  if (!res.ok) {
    throw new Error(data?.error || `Server returned ${res.status}. Is "npm run app" running?`);
  }
  return data;
}

export const api = {
  get: (p) => request("GET", p),
  post: (p, b = {}) => request("POST", p, b),
  put: (p, b) => request("PUT", p, b)
};
