import { DurableObject } from 'cloudflare:workers';
import { DEFAULT_MISSION, JUAN_VERSION, publicSnapshot, validateMissionPatch } from './domain.mjs';

const HEARTBEAT_MS = 15 * 60 * 1000;
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function asMessage(error) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function requireAdmin(request, env) {
  // Until the owner configures a secret, every administrative action is locked.
  if (!env.JUAN_ADMIN_TOKEN || !request.headers.has('x-juan-admin-token')) return false;
  const provided = request.headers.get('x-juan-admin-token') ?? '';
  const expected = String(env.JUAN_ADMIN_TOKEN);
  const encoder = new TextEncoder();
  const a = encoder.encode(provided);
  const b = encoder.encode(expected);
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

export class JuanCore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          kind TEXT NOT NULL,
          detail TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ledger (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          entry_type TEXT NOT NULL CHECK(entry_type IN ('revenue', 'cost')),
          amount_cny INTEGER NOT NULL CHECK(amount_cny >= 0),
          evidence_reference TEXT NOT NULL
        );
      `);
      const existing = this.ctx.storage.sql.exec('SELECT value FROM settings WHERE key = ?', 'mission').toArray();
      if (existing.length === 0) {
        this.ctx.storage.sql.exec('INSERT INTO settings(key, value) VALUES (?, ?)', 'mission', JSON.stringify(DEFAULT_MISSION));
        this.record('created', 'Juan initialized with safe defaults');
      }
      if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
    });
  }

  record(kind, detail) {
    this.ctx.storage.sql.exec('INSERT INTO events(timestamp, kind, detail) VALUES (?, ?, ?)', new Date().toISOString(), kind, detail);
    // Keep the lightweight bootstrap log bounded.
    this.ctx.storage.sql.exec('DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 1000)');
  }

  mission() {
    const row = this.ctx.storage.sql.exec('SELECT value FROM settings WHERE key = ?', 'mission').one();
    return JSON.parse(row.value);
  }

  async status() {
    const heartbeatCount = this.ctx.storage.sql.exec("SELECT COUNT(*) AS n FROM events WHERE kind = 'heartbeat'").one().n;
    const eventCount = this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM events').one().n;
    const latest = this.ctx.storage.sql.exec("SELECT timestamp FROM events WHERE kind = 'heartbeat' ORDER BY id DESC LIMIT 1").toArray();
    return publicSnapshot({ state: this.mission(), heartbeatCount, eventCount, latestHeartbeat: latest[0]?.timestamp ?? null });
  }

  async privateStatus() {
    const events = this.ctx.storage.sql.exec('SELECT id, timestamp, kind, detail FROM events ORDER BY id DESC LIMIT 100').toArray();
    const ledger = this.ctx.storage.sql.exec('SELECT id, timestamp, entry_type, amount_cny, evidence_reference FROM ledger ORDER BY id DESC LIMIT 100').toArray();
    return { mission: this.mission(), events, ledger, stage: 'phase-0-safe-bootstrap' };
  }

  async updateMission(candidate) {
    const patch = validateMissionPatch(candidate);
    const updated = { ...this.mission(), ...patch };
    this.ctx.storage.sql.exec('UPDATE settings SET value = ? WHERE key = ?', JSON.stringify(updated), 'mission');
    this.record('mission-updated', 'Owner edited non-privileged mission fields');
    return updated;
  }

  async alarm() {
    this.record('heartbeat', 'Wake cycle completed. Model and external tools remain disabled.');
    await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
  }
}

const DASHBOARD = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Juan — 自主创业 Agent</title>
<style>
:root{color-scheme:light;--ink:#152438;--navy:#173459;--muted:#6b7888;--line:#dae2eb;--bg:#eff3f7;--card:#fff;--green:#207c61;--amber:#a26d14}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif}
.top{background:var(--navy);color:#fff;border-bottom:5px solid #ba964b}.wrap{max-width:1080px;margin:auto;padding:0 24px}.top .wrap{padding-top:25px;padding-bottom:25px;display:flex;justify-content:space-between;align-items:center;gap:24px}
.brand{font-size:28px;font-weight:750;letter-spacing:.02em}.sub{font-size:12px;color:#c4d3e4;letter-spacing:.12em}.tag{font-size:12px;padding:5px 11px;border:1px solid #8fabc9;border-radius:3px;color:#d9e7f7}
main{padding-top:28px;padding-bottom:50px}.hero{background:var(--card);border:1px solid var(--line);border-left:5px solid #ba964b;padding:24px 28px;margin-bottom:18px}.hero h1{margin:0 0 8px;font-size:23px}.hero p{margin:0;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:18px 0}.panel{background:var(--card);border:1px solid var(--line);padding:20px;min-height:115px}.label{font-size:12px;color:var(--muted);margin-bottom:12px}.value{font-size:25px;font-weight:700;line-height:1.2}.tiny{font-size:12px;color:var(--muted);margin-top:8px}.ok{color:var(--green)}.warn{color:var(--amber)}
.split{display:grid;grid-template-columns:1.3fr 1fr;gap:18px}.section{background:var(--card);border:1px solid var(--line);padding:24px}.section h2{margin:0 0 16px;font-size:17px;border-bottom:1px solid var(--line);padding-bottom:12px}.row{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid #e9eef3}.row:last-child{border-bottom:none}.hint{font-size:13px;color:var(--muted);margin:14px 0 0}.foot{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:20px;color:var(--muted);font-size:12px}
button{background:var(--navy);color:#fff;padding:9px 16px;border:0;border-radius:3px;cursor:pointer;font:inherit}button:hover{background:#28527e}button:disabled{opacity:.6;cursor:wait}
@media(max-width:800px){.grid{grid-template-columns:repeat(2,1fr)}.split{grid-template-columns:1fr}}@media(max-width:480px){.grid{grid-template-columns:1fr 1fr}.panel{padding:14px}.value{font-size:21px}.top .wrap{padding:18px 16px}.wrap{padding-left:16px;padding-right:16px}.hero{padding:20px}}
</style></head><body>
<header class="top"><div class="wrap"><div><div class="sub">AUTONOMOUS BUSINESS AGENT</div><div class="brand">JUAN <span style="font-weight:300">/ 控制中心</span></div></div><span class="tag">独立环境 · V0.1</span></div></header>
<main class="wrap"><section class="hero"><h1>让 Juan 自主探索，但每一步都有边界。</h1><p>当前为基础设施验证阶段。模型、联网执行、对外发布和付款全部关闭；定时唤醒与持久状态独立运行。</p></section>
<div class="grid"><div class="panel"><div class="label">运行状态</div><div class="value ok" id="phase">载入中</div><div class="tiny">Cloudflare Durable Object</div></div><div class="panel"><div class="label">自主唤醒次数</div><div class="value" id="ticks">—</div><div class="tiny">每15分钟一次</div></div><div class="panel"><div class="label">验证收入</div><div class="value" id="revenue">¥0</div><div class="tiny">以实际到账为准</div></div><div class="panel"><div class="label">新增现金支出</div><div class="value" id="cash">¥0</div><div class="tiny">目前禁止任何支出</div></div></div>
<div class="split"><section class="section"><h2>自治边界</h2><div class="row"><span>自主目标</span><strong>探索合法的真实付费机会</strong></div><div class="row"><span>模型</span><strong class="warn">vLLM / 待安全连接</strong></div><div class="row"><span>外部行动</span><strong class="warn">关闭</strong></div><div class="row"><span>支付与采购</span><strong class="warn">关闭</strong></div><div class="row"><span>首笔到账目标</span><strong>¥1</strong></div><p class="hint">未来接入模型和工具时，仍需管理员批准扩权；任何被拒绝的操作都不应被自动重试为另一条未授权路径。</p></section><section class="section"><h2>基础设施状态</h2><div class="row"><span>记忆系统</span><strong class="ok">持久化就绪</strong></div><div class="row"><span>执行日志</span><strong id="events">—</strong></div><div class="row"><span>最后唤醒</span><strong id="last">等待首次触发</strong></div><div class="row"><span>LLM Adapter</span><strong class="warn">安全门禁</strong></div><p class="hint" id="notice">正在检查服务状态……</p><button id="refresh" type="button">刷新状态</button></section></div>
<footer class="foot"><span>Juan · Phase 0 / 安全空载版</span><span id="updated">—</span></footer></main>
<script>
(function(){var b=document.getElementById('refresh');async function refresh(){b.disabled=true;try{var r=await fetch('/api/status',{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);var d=await r.json();document.getElementById('phase').textContent=d.phase==='infrastructure'?'基础设施在线':'待检查';document.getElementById('ticks').textContent=String(d.activity.heartbeatCount);document.getElementById('events').textContent=String(d.activity.eventCount)+' 条';document.getElementById('revenue').textContent='¥'+d.finance.verifiedRevenueCny;document.getElementById('cash').textContent='¥'+d.finance.newCashSpendCny;document.getElementById('last').textContent=d.activity.latestHeartbeat?new Date(d.activity.latestHeartbeat).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'等待首次触发';document.getElementById('updated').textContent='更新于 '+new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'});document.getElementById('notice').textContent='读取的是 Durable Object 持久状态；没有模拟业务收入。';}catch(e){document.getElementById('phase').textContent='查询失败';document.getElementById('notice').textContent='连接异常：'+e.message;}finally{b.disabled=false;}}b.addEventListener('click',refresh);refresh();})();
</script></body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/' && request.method === 'GET') {
        return new Response(DASHBOARD, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" } });
      }
      if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, service: 'juan', version: JUAN_VERSION });
      if (url.pathname === '/api/status' && request.method === 'GET') return json(await env.JUAN_CORE.getByName('juan-primary').status());

      if (url.pathname.startsWith('/api/admin/')) {
        if (!requireAdmin(request, env)) return json({ error: 'Management access is disabled or unauthorized' }, 403);
        const core = env.JUAN_CORE.getByName('juan-primary');
        if (url.pathname === '/api/admin/state' && request.method === 'GET') return json(await core.privateStatus());
        if (url.pathname === '/api/admin/mission' && request.method === 'PATCH') {
          const size = Number(request.headers.get('content-length') ?? 0);
          if (size > 4096) return json({ error: 'Payload too large' }, 413);
          const body = await request.json();
          return json({ mission: await core.updateMission(body) });
        }
        return json({ error: 'Not found' }, 404);
      }
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      console.error(JSON.stringify({ event: 'juan.request_failed', path: url.pathname, error: asMessage(error) }));
      return json({ error: 'Internal error' }, 500);
    }
  },
};
