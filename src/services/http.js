const config = {
  baseUrl: import.meta.env.VITE_API_BASE_URL || "/api",
  timeoutMs: Number(import.meta.env.VITE_REQUEST_TIMEOUT_MS || 6000),
  useMock: import.meta.env.VITE_USE_MOCK === "true",
};

function normalizeBaseUrl(baseUrl) {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function buildQuery(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "" && value !== "all") {
      query.set(key, value);
    }
  });
  const text = query.toString();
  return text ? `?${text}` : "";
}

export function shouldUseMock() {
  return config.useMock;
}

export async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}${path}`, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      signal: controller.signal,
      ...options,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `HTTP ${response.status}`);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

export { buildQuery };
