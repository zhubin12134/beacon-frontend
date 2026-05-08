import { mockDashboard } from "../mock/dashboard";
import { buildQuery, request, shouldUseMock } from "./http";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function wait(ms = 160) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function withMockFallback(apiCall, mockCall) {
  if (shouldUseMock()) {
    await wait();
    return { source: "mock", data: mockCall() };
  }

  try {
    return { source: "api", data: await apiCall() };
  } catch (error) {
    await wait();
    return { source: "mock", data: mockCall(), error };
  }
}

export function getDashboard(filters) {
  return withMockFallback(
    () => request(`/dashboard${buildQuery(filters)}`),
    () => clone(mockDashboard)
  );
}

export function createCustomMetric(payload) {
  return withMockFallback(
    () =>
      request("/custom-metrics", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    () => ({
      id: `CM-${Date.now()}`,
      name: payload.name,
      owner: payload.owner || "自定义",
      value: "待采集",
      trend: "新建",
      status: "healthy",
      type: payload.type,
      query: payload.query,
      threshold: payload.threshold,
    })
  );
}

export function ackAlerts(alertIds) {
  return withMockFallback(
    () =>
      request("/alerts/ack", {
        method: "POST",
        body: JSON.stringify({ alertIds }),
      }),
    () => ({
      acknowledged: alertIds,
      acknowledgedAt: new Date().toISOString(),
    })
  );
}

export function listNotifyChannels() {
  return withMockFallback(
    () => request("/notify/channels"),
    () => []
  );
}

export function createNotifyChannel(payload) {
  return withMockFallback(
    () =>
      request("/notify/channels", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    () => ({ id: `CH-${Date.now()}`, ...payload, createdAt: new Date().toISOString() })
  );
}

export function listNotifyPolicies() {
  return withMockFallback(
    () => request("/notify/policies"),
    () => []
  );
}

export function createNotifyPolicy(payload) {
  return withMockFallback(
    () =>
      request("/notify/policies", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    () => ({ id: `PL-${Date.now()}`, ...payload, createdAt: new Date().toISOString() })
  );
}

export function notifyTest(payload) {
  return withMockFallback(
    () =>
      request("/notify/test", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    () => ({
      deliveries: [
        {
          id: `DL-${Date.now()}`,
          eventTitle: payload.title,
          channelId: "mock",
          channel: "Mock Channel",
          status: "success",
          createdAt: new Date().toISOString(),
        },
      ],
    })
  );
}

export function listNotifyDeliveries() {
  return withMockFallback(
    () => request("/notify/deliveries"),
    () => []
  );
}

export function retryDelivery(id) {
  return withMockFallback(
    () =>
      request(`/notify/deliveries/${id}/retry`, {
        method: "POST",
      }),
    () => ({ id: `DL-retry-${Date.now()}`, eventTitle: `manual retry: ${id}`, status: "success", createdAt: new Date().toISOString() })
  );
}

export function createSilence(payload) {
  return withMockFallback(
    () =>
      request("/alerts/silences", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    () => ({ id: `SL-${Date.now()}` })
  );
}
