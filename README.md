# MonitorHub 总控制台前端

技术栈：

- Vue 3
- ECharts
- Vite
- Fetch API

## 运行

```bash
npm install
npm run dev
```

默认访问：

```text
http://127.0.0.1:5173
```

## 环境变量

复制 `.env.example` 为 `.env.local` 后按需调整：

```env
VITE_API_BASE_URL=/api
VITE_API_PROXY_TARGET=http://127.0.0.1:8080
VITE_USE_MOCK=false
VITE_REQUEST_TIMEOUT_MS=6000
```

说明：

- `VITE_API_BASE_URL`：前端请求接口前缀，默认 `/api`。
- `VITE_API_PROXY_TARGET`：开发环境代理到 Go Gin/Fiber 后端。
- `VITE_USE_MOCK=true`：强制使用 Mock 数据。
- 接口不可用时，前端会自动 fallback 到 Mock 数据，页面右上角会显示 `Mock 数据`。

## 已接接口

- `GET /api/dashboard`
- `POST /api/custom-metrics`
- `POST /api/alerts/ack`

接口结构参考：

- `../docs/api-contract.md`
- `../docs/openapi.yaml`

## 目录

```text
frontend/
  src/
    App.vue
    main.js
    styles.css
    mock/dashboard.js
    services/http.js
    services/dashboardApi.js
```

## 与后端对接

Go 后端实现 `/api/dashboard` 后，返回结构中建议包含：

- `sites`：客户平台实例状态。
- `alerts`：Alertmanager 或业务告警事件。
- `customMetrics`：自定义指标定义和最新值。
- `topology` / `topologyLinks`：链路拓扑。
- `timeseries`：从 Prometheus 或 VictoriaMetrics 查询得到的趋势数据。
