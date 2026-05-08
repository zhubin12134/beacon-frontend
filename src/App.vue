<script setup>
import { LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import {
  ackAlerts,
  createCustomMetric,
  createNotifyChannel,
  createNotifyPolicy,
  createSilence,
  getDashboard,
  listNotifyChannels,
  listNotifyDeliveries,
  listNotifyPolicies,
  notifyTest,
  retryDelivery,
} from "./services/dashboardApi";

use([GridComponent, LegendComponent, TooltipComponent, LineChart, PieChart, CanvasRenderer]);

const statusText = { healthy: "健康", warning: "风险", critical: "故障", info: "提示" };

const state = reactive({
  scope: "all",
  status: "all",
  keyword: "",
  loading: false,
  dataSource: "unknown",
  sourceError: "",
  sites: [],
  alerts: [],
  customMetrics: [],
  topology: [],
  topologyLinks: [],
  timeseries: { availability: [], latencyP95: [] },
  notifyChannels: [],
  notifyPolicies: [],
  notifyDeliveries: [],
});

const metricForm = reactive({ name: "", query: "", threshold: "", type: "promql" });
const notifyChannelForm = reactive({ name: "", type: "dingtalk", enabled: true, webhookUrl: "", scriptPath: "", timeoutSec: 8 });
const notifyPolicyForm = reactive({ name: "", enabled: true, severity: "warning,critical", keyword: "", channelIds: "", silenceMins: 30 });
const notifyTestForm = reactive({ title: "测试告警", detail: "这是一条测试通知", severity: "warning", channelIds: "" });
const silenceForm = reactive({ name: "业务维护窗口", matcherKey: "site", matcherVal: "all", startsAt: "", endsAt: "" });

const metricDialogOpen = ref(false);
const activeView = ref("overview");
const toast = ref("");
const componentChartRef = ref(null);
const trendChartRef = ref(null);
const sitePanelRef = ref(null);
const alertPanelRef = ref(null);
const customPanelRef = ref(null);
const notifyPanelRef = ref(null);
let componentChart;
let trendChart;
let toastTimer;

const filteredSites = computed(() => {
  const keyword = state.keyword.trim().toLowerCase();
  return state.sites.filter((site) => {
    const scopeMatched = state.scope === "all" || site.network === state.scope;
    const statusMatched = state.status === "all" || site.status === state.status;
    const haystack = [site.name, site.region, site.chain, Object.keys(site.components || {}).join(" ")]
      .join(" ")
      .toLowerCase();
    return scopeMatched && statusMatched && (!keyword || haystack.includes(keyword));
  });
});

const visibleAlerts = computed(() => {
  const keyword = state.keyword.trim().toLowerCase();
  return state.alerts.filter((alert) => {
    const haystack = [alert.site, alert.title, alert.detail, alert.level].join(" ").toLowerCase();
    return !keyword || haystack.includes(keyword);
  });
});

const summary = computed(() => {
  const onlineCount = state.sites.filter((site) => site.network === "online").length;
  const offlineCount = state.sites.length - onlineCount;
  const criticalCount = state.alerts.filter((alert) => alert.level === "critical").length;
  const componentIssueCount = filteredSites.value.reduce((sum, site) => {
    return (
      sum +
      Object.values(site.components || {}).filter((status) => status === "warning" || status === "critical").length
    );
  }, 0);
  const availability =
    filteredSites.value.reduce((sum, site) => sum + Number(site.availability || 0), 0) /
    Math.max(filteredSites.value.length, 1);
  return { onlineCount, offlineCount, criticalCount, componentIssueCount, availability: availability.toFixed(2) };
});

const componentCounts = computed(() => {
  return filteredSites.value.reduce(
    (counts, site) => {
      Object.values(site.components || {}).forEach((status) => {
        counts[status] = (counts[status] || 0) + 1;
      });
      return counts;
    },
    { healthy: 0, warning: 0, critical: 0 }
  );
});

const topologyNodeMap = computed(() => new Map(state.topology.map((node) => [node.id, node])));

function showToast(message) {
  toast.value = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = ""), 2600);
}

function applyDashboard(payload) {
  state.sites = payload.sites || [];
  state.alerts = payload.alerts || [];
  state.customMetrics = payload.customMetrics || [];
  state.topology = payload.topology || [];
  state.topologyLinks = payload.topologyLinks || [];
  state.timeseries = payload.timeseries || { availability: [], latencyP95: [] };
}

function switchView(view) {
  activeView.value = view;
  nextTick(() => {
    const map = {
      overview: null,
      sites: sitePanelRef.value,
      alerts: alertPanelRef.value,
      custom: customPanelRef.value,
      notify: notifyPanelRef.value,
    };
    const target = map[view];
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

async function loadDashboard(showSuccess = false) {
  state.loading = true;
  try {
    const result = await getDashboard({ network: state.scope, status: state.status, keyword: state.keyword.trim() });
    state.dataSource = result.source;
    state.sourceError = result.error?.message || "";
    applyDashboard(result.data);
    await nextTick();
    renderCharts();
    if (showSuccess) showToast(result.source === "api" ? "数据已刷新" : "接口不可用，已切换 Mock");
  } catch (error) {
    showToast(`加载失败：${error.message}`);
  } finally {
    state.loading = false;
  }
}

async function loadNotifyConfig() {
  const [channelsRes, policiesRes, deliveriesRes] = await Promise.all([
    listNotifyChannels(),
    listNotifyPolicies(),
    listNotifyDeliveries(),
  ]);
  state.notifyChannels = channelsRes.data || [];
  state.notifyPolicies = policiesRes.data || [];
  state.notifyDeliveries = deliveriesRes.data || [];
}

async function saveMetric() {
  if (!metricForm.name.trim() || !metricForm.query.trim()) return showToast("指标名称和查询表达式不能为空");
  const result = await createCustomMetric({
    name: metricForm.name.trim(),
    query: metricForm.query.trim(),
    threshold: metricForm.threshold.trim(),
    type: metricForm.type,
  });
  state.customMetrics.unshift(result.data);
  metricDialogOpen.value = false;
  Object.assign(metricForm, { name: "", query: "", threshold: "", type: "promql" });
  showToast("自定义指标已保存");
}

async function ackVisibleAlerts() {
  const alertIds = visibleAlerts.value.filter((alert) => alert.level !== "critical").map((alert) => alert.id);
  if (!alertIds.length) return showToast("没有可批量确认的非严重告警");
  await ackAlerts(alertIds);
  state.alerts = state.alerts.filter((alert) => !alertIds.includes(alert.id));
  showToast(`已确认 ${alertIds.length} 条告警`);
}

async function submitChannel() {
  if (!notifyChannelForm.name.trim()) return showToast("渠道名称不能为空");
  const result = await createNotifyChannel({
    name: notifyChannelForm.name.trim(),
    type: notifyChannelForm.type,
    enabled: notifyChannelForm.enabled,
    webhookUrl: notifyChannelForm.webhookUrl.trim(),
    scriptPath: notifyChannelForm.scriptPath.trim(),
    timeoutSec: Number(notifyChannelForm.timeoutSec) || 8,
  });
  state.notifyChannels.unshift(result.data);
  Object.assign(notifyChannelForm, { name: "", type: "dingtalk", enabled: true, webhookUrl: "", scriptPath: "", timeoutSec: 8 });
  showToast("通知渠道已创建");
}

async function submitPolicy() {
  if (!notifyPolicyForm.name.trim()) return showToast("策略名称不能为空");
  const result = await createNotifyPolicy({
    name: notifyPolicyForm.name.trim(),
    enabled: notifyPolicyForm.enabled,
    severity: notifyPolicyForm.severity.split(",").map((x) => x.trim()).filter(Boolean),
    keyword: notifyPolicyForm.keyword.trim(),
    channelIds: notifyPolicyForm.channelIds.split(",").map((x) => x.trim()).filter(Boolean),
    silenceMins: Number(notifyPolicyForm.silenceMins) || 0,
  });
  state.notifyPolicies.unshift(result.data);
  Object.assign(notifyPolicyForm, { name: "", enabled: true, severity: "warning,critical", keyword: "", channelIds: "", silenceMins: 30 });
  showToast("通知策略已创建");
}

async function sendNotifyTest() {
  const channelIds = notifyTestForm.channelIds.split(",").map((x) => x.trim()).filter(Boolean);
  const result = await notifyTest({
    title: notifyTestForm.title.trim(),
    detail: notifyTestForm.detail.trim(),
    severity: notifyTestForm.severity,
    channelIds,
  });
  state.notifyDeliveries = [...(result.data?.deliveries || []), ...state.notifyDeliveries];
  showToast("测试发送已执行");
}

async function retryOneDelivery(id) {
  const result = await retryDelivery(id);
  if (result.data) state.notifyDeliveries.unshift(result.data);
  showToast("已触发重试");
}

async function submitSilence() {
  if (!silenceForm.name.trim()) return showToast("静默名称不能为空");
  await createSilence(silenceForm);
  showToast("静默已创建");
}

function initCharts() {
  if (componentChartRef.value && !componentChart) componentChart = init(componentChartRef.value);
  if (trendChartRef.value && !trendChart) trendChart = init(trendChartRef.value);
}

function renderCharts() {
  initCharts();
  componentChart?.setOption({
    color: ["#2f9e44", "#f08c00", "#e03131"],
    tooltip: { trigger: "item" },
    legend: { bottom: 0, itemWidth: 10, itemHeight: 10 },
    series: [{ name: "组件状态", type: "pie", radius: ["56%", "74%"], center: ["50%", "44%"], label: { formatter: "{b} {c}" }, data: [
      { name: "健康", value: componentCounts.value.healthy },
      { name: "风险", value: componentCounts.value.warning },
      { name: "故障", value: componentCounts.value.critical },
    ] }],
  });
  trendChart?.setOption({
    color: ["#1967d2", "#e03131"],
    tooltip: { trigger: "axis" },
    grid: { left: 42, right: 22, top: 32, bottom: 36 },
    legend: { top: 0 },
    xAxis: { type: "category", data: state.timeseries.availability.map((item) => item[0]) },
    yAxis: [{ type: "value", min: 95, max: 100, axisLabel: { formatter: "{value}%" } }, { type: "value", axisLabel: { formatter: "{value}ms" } }],
    series: [
      { name: "可用率", type: "line", smooth: true, yAxisIndex: 0, data: state.timeseries.availability.map((item) => item[1]), areaStyle: { opacity: 0.08 } },
      { name: "P95 延迟", type: "line", smooth: true, yAxisIndex: 1, data: state.timeseries.latencyP95.map((item) => item[1]) },
    ],
  });
}

watch([filteredSites, () => state.timeseries], () => nextTick(renderCharts), { deep: true });
onMounted(async () => {
  await Promise.all([loadDashboard(), loadNotifyConfig()]);
  window.addEventListener("resize", () => {
    componentChart?.resize();
    trendChart?.resize();
  });
});
onBeforeUnmount(() => window.clearTimeout(toastTimer));
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar" aria-label="main-nav">
      <div class="brand"><span class="brand-mark">M</span><div><strong>MonitorHub</strong><span>Vue3 + ECharts</span></div></div>
      <nav class="nav-list">
        <button class="nav-item" :class="{ active: activeView === 'overview' }" type="button" @click="switchView('overview')"><span class="icon">⌂</span>总览</button>
        <button class="nav-item" :class="{ active: activeView === 'sites' }" type="button" @click="switchView('sites')"><span class="icon">▦</span>平台实例</button>
        <button class="nav-item" :class="{ active: activeView === 'alerts' }" type="button" @click="switchView('alerts')"><span class="icon">!</span>告警中心</button>
        <button class="nav-item" :class="{ active: activeView === 'custom' }" type="button" @click="switchView('custom')"><span class="icon">◇</span>自定义指标</button>
        <button class="nav-item" :class="{ active: activeView === 'notify' }" type="button" @click="switchView('notify')"><span class="icon">⚙</span>通知配置</button>
      </nav>
    </aside>

    <main class="main">
      <header class="topbar">
        <div><p class="eyebrow">总控制台</p><h1>学习平台多客户监控</h1></div>
        <div class="toolbar">
          <label class="search"><span>⌕</span><input v-model="state.keyword" type="search" placeholder="搜索客户、组件、告警" /></label>
          <select v-model="state.scope"><option value="all">全部环境</option><option value="online">可外网访问</option><option value="offline">仅内网</option></select>
          <span class="data-source" :class="state.dataSource">{{ state.dataSource === "api" ? "实时接口" : "Mock 数据" }}</span>
          <button class="primary-action" :disabled="state.loading" type="button" @click="loadDashboard(true)">{{ state.loading ? "加载中" : "刷新" }}</button>
        </div>
      </header>

      <section class="summary-grid">
        <article class="metric-card"><span>接入平台</span><strong>{{ filteredSites.length }}</strong><small>{{ summary.onlineCount }} 个可总控，{{ summary.offlineCount }} 个内网自治</small></article>
        <article class="metric-card danger"><span>严重告警</span><strong>{{ summary.criticalCount }}</strong><small>影响登录、课程、任务或消息链路</small></article>
        <article class="metric-card warning"><span>组件异常</span><strong>{{ summary.componentIssueCount }}</strong><small>Nginx / Tomcat / MQ / DB / 可观测组件</small></article>
        <article class="metric-card"><span>平均可用率</span><strong>{{ summary.availability }}%</strong><small>最近 24 小时</small></article>
      </section>

      <section class="content-grid">
        <article ref="sitePanelRef" class="panel span-8">
          <div class="panel-head"><div><h2>平台实例状态</h2><p>按客户隔离环境汇总，外网可达环境同步到总控制台。</p></div></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>客户环境</th><th>网络</th><th>健康度</th><th>核心链路</th><th>最近上报</th><th>状态</th></tr></thead>
              <tbody>
                <tr v-if="!filteredSites.length"><td class="empty-cell" colspan="6">没有匹配的平台实例</td></tr>
                <tr v-for="site in filteredSites" :key="site.id">
                  <td><div class="site-name"><strong>{{ site.name }}</strong><span>{{ site.region }}</span></div></td>
                  <td><span class="pill" :class="site.network">{{ site.network === "online" ? "外网可达" : "仅内网" }}</span></td>
                  <td><div class="health-cell"><span>{{ site.health }}</span><div class="bar"><i :style="{ width: `${site.health}%` }"></i></div></div></td>
                  <td>{{ site.chain }}</td><td>{{ site.lastSeen }}</td><td><span class="status" :class="site.status">{{ statusText[site.status] }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="panel span-4"><div class="panel-head compact"><h2>组件健康分布</h2><span>{{ componentCounts.healthy + componentCounts.warning + componentCounts.critical }} checks</span></div><div ref="componentChartRef" class="chart"></div></article>
        <article class="panel span-7"><div class="panel-head compact"><h2>可用率与延迟趋势</h2><span>Prometheus / VictoriaMetrics</span></div><div ref="trendChartRef" class="chart wide"></div></article>

        <article ref="alertPanelRef" class="panel span-5">
          <div class="panel-head compact"><h2>告警队列</h2><button class="text-button" type="button" @click="ackVisibleAlerts">批量确认</button></div>
          <div class="alert-list">
            <div v-if="!visibleAlerts.length" class="empty-state">当前没有匹配的告警</div>
            <article v-for="alert in visibleAlerts" :key="alert.id" class="alert-item" :class="alert.level">
              <div class="alert-top"><span class="status" :class="alert.level">{{ statusText[alert.level] }}</span><time>{{ alert.time }}</time></div>
              <strong>{{ alert.title }}</strong><p>{{ alert.site }} · {{ alert.detail }}</p>
            </article>
          </div>
        </article>

        <article class="panel span-7">
          <div class="panel-head"><div><h2>关键链路拓扑</h2><p>入口、应用、中间件、任务、可观测和数据库依赖关系。</p></div></div>
          <div class="topology">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <line v-for="(link, index) in state.topologyLinks" :key="`${link[0]}-${link[1]}-${index}`" :x1="`${topologyNodeMap.get(link[0])?.x || 0}%`" :y1="`${topologyNodeMap.get(link[0])?.y || 0}%`" :x2="`${topologyNodeMap.get(link[1])?.x || 0}%`" :y2="`${topologyNodeMap.get(link[1])?.y || 0}%`" />
            </svg>
            <button v-for="node in state.topology" :key="node.id" class="topology-node" :class="node.group" :style="{ left: `${node.x}%`, top: `${node.y}%` }" type="button">{{ node.label }}</button>
          </div>
        </article>

        <article ref="customPanelRef" class="panel span-5">
          <div class="panel-head compact"><h2>自定义指标</h2><button class="text-button" type="button" @click="metricDialogOpen = true">新增指标</button></div>
          <div class="custom-metrics">
            <div v-if="!state.customMetrics.length" class="empty-state">还没有自定义指标</div>
            <article v-for="metric in state.customMetrics" :key="metric.id || metric.name" class="custom-card">
              <div><span>{{ metric.owner }}</span><strong>{{ metric.name }}</strong></div>
              <div class="metric-value"><strong>{{ metric.value }}</strong><span :class="metric.status">{{ metric.trend }}</span></div>
              <code>{{ metric.query }}</code>
            </article>
          </div>
        </article>

        <article ref="notifyPanelRef" class="panel span-8">
          <div class="panel-head"><div><h2>通知配置</h2><p>统一 API 配置渠道、策略、测试发送、投递记录和静默。</p></div></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>新增渠道</th><th>类型</th><th>Webhook/脚本</th><th>超时</th><th>操作</th></tr></thead>
              <tbody>
                <tr>
                  <td><input v-model="notifyChannelForm.name" placeholder="渠道名" /></td>
                  <td><select v-model="notifyChannelForm.type"><option value="dingtalk">dingtalk</option><option value="webhook">webhook</option><option value="script">script</option></select></td>
                  <td>
                    <div class="stack-fields">
                      <input v-model="notifyChannelForm.webhookUrl" placeholder="webhook URL" />
                      <input v-model="notifyChannelForm.scriptPath" placeholder="script path" />
                    </div>
                  </td>
                  <td><input v-model="notifyChannelForm.timeoutSec" type="number" min="2" /></td>
                  <td><button class="text-button" type="button" @click="submitChannel">创建</button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="custom-metrics">
            <article v-for="ch in state.notifyChannels" :key="ch.id" class="custom-card"><div><span>{{ ch.type }}</span><strong>{{ ch.name }}</strong></div><div class="metric-value"><strong>{{ ch.enabled ? "启用" : "停用" }}</strong><span class="healthy">{{ ch.id }}</span></div><code>{{ ch.webhookUrl || ch.scriptPath || "-" }}</code></article>
          </div>
        </article>

        <article class="panel span-4">
          <div class="panel-head compact"><h2>策略 / 测试 / 静默</h2></div>
          <div class="custom-metrics">
            <article class="custom-card form-card">
              <div><span>新策略</span><strong><input v-model="notifyPolicyForm.name" placeholder="策略名" /></strong></div>
              <div class="stack-fields">
                <input v-model="notifyPolicyForm.severity" placeholder="warning,critical" />
                <input v-model="notifyPolicyForm.channelIds" placeholder="CH-xx,CH-yy" />
              </div>
              <code><button class="text-button" type="button" @click="submitPolicy">创建策略</button></code>
            </article>
            <article class="custom-card form-card">
              <div><span>测试发送</span><strong><input v-model="notifyTestForm.title" placeholder="标题" /></strong></div>
              <div class="stack-fields">
                <select v-model="notifyTestForm.severity"><option value="info">info</option><option value="warning">warning</option><option value="critical">critical</option></select>
                <input v-model="notifyTestForm.channelIds" placeholder="指定渠道ID(可空)" />
              </div>
              <code><button class="text-button" type="button" @click="sendNotifyTest">发送测试</button></code>
            </article>
            <article class="custom-card form-card">
              <div><span>创建静默</span><strong><input v-model="silenceForm.name" placeholder="静默名" /></strong></div>
              <div class="stack-fields">
                <input v-model="silenceForm.matcherKey" placeholder="matcher key" />
                <input v-model="silenceForm.matcherVal" placeholder="matcher value" />
              </div>
              <code><button class="text-button" type="button" @click="submitSilence">创建静默</button></code>
            </article>
          </div>
        </article>

        <article class="panel span-12">
          <div class="panel-head compact"><h2>投递记录</h2></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>时间</th><th>事件</th><th>渠道</th><th>状态</th><th>错误</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-if="!state.notifyDeliveries.length"><td colspan="6" class="empty-cell">暂无投递记录</td></tr>
                <tr v-for="d in state.notifyDeliveries" :key="d.id">
                  <td>{{ d.createdAt }}</td><td>{{ d.eventTitle }}</td><td>{{ d.channel }}</td><td><span class="status" :class="d.status === 'success' ? 'healthy' : 'critical'">{{ d.status }}</span></td><td>{{ d.errorText || "-" }}</td>
                  <td><button class="text-button" type="button" @click="retryOneDelivery(d.id)">重试</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </main>

    <div v-if="metricDialogOpen" class="dialog-mask" @click.self="metricDialogOpen = false">
      <form class="dialog-card" @submit.prevent="saveMetric">
        <div class="panel-head compact"><h2>新增自定义指标</h2><button class="icon-button" type="button" @click="metricDialogOpen = false">×</button></div>
        <label>指标名称<input v-model="metricForm.name" placeholder="例如：课程播放成功率" /></label>
        <label>类型<select v-model="metricForm.type"><option value="promql">PromQL</option><option value="sql">SQL</option><option value="http">HTTP</option><option value="script">Script</option></select></label>
        <label>查询表达式<input v-model="metricForm.query" placeholder="rate(course_play_success_total[5m])" /></label>
        <label>阈值<input v-model="metricForm.threshold" placeholder="低于 99.5% 告警" /></label>
        <menu><button type="button" @click="metricDialogOpen = false">取消</button><button class="primary-action" type="submit">保存</button></menu>
      </form>
    </div>

    <div class="toast" :class="{ visible: toast }" role="status" aria-live="polite">{{ toast }}</div>
  </div>
</template>
