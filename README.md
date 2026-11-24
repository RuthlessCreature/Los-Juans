# Juan — Autonomous Business Agent

Juan 是一个基于 Cloudflare Worker + Durable Object 的自主创业 Agent 项目，目标是在明确授权和预算边界内，自主研究真实付费机会，验证业务假设，并记录可核对的商业结果。

## 目前版本：0.2.0（只读探索版）

已实现：

- 独立 Worker 的只读控制台与健康检查。
- SQLite-backed Durable Object，持久保存使命、事件和财务记录表。
- 每 15 分钟一次的自动唤醒（无需持续运行本地进程）。
- 每 6 小时从固定的 [HN Algolia Search API](https://hn.algolia.com/api) 读取近期公开评论，提取**未经验证的需求线索**；HTTPS 来源链接、原文片段和初步假设存入 SQLite，自动去重，最多保留 500 条。
- 模型适配器：兼容 OpenAI Chat Completions 格式，强制 HTTPS、禁止重定向、超时控制、严格解析机会评估 JSON。
- 机会池和行动审批队列：记录待审、批准、拒绝状态；即使批准，当前版本也**没有对外执行器**。
- 公开接口仅返回经过裁剪的安全状态；管理接口默认锁定。
- 首笔收入目标 ¥1；实际到账收入初始化为 ¥0，绝不生成虚构收款。
- 默认关闭：大模型调用、对外互动、付费操作、任何未授权工具执行。
- vLLM 主模型预留为后续接入目标；不包含服务器地址或 API Key。

尚未实现：实际连通 vLLM、安全授权后的自动商业评估、客户接洽、付款渠道及成交验证。当前的公开信息采集不意味着具备自主意识、找到付费客户或已获得收入。线索可能是噪音，必须后续核实。

## 接口

| HTTP | 路径 | 内容 |
| --- | --- | --- |
| GET | `/` | 状态控制台（公开且无敏感信息） |
| GET | `/health` | Worker 健康状态 |
| GET | `/api/status` | Durable Object 持久状态摘要 |
| GET | `/api/admin/state` | 管理员私有状态、机会池（最新 100）、审批队列（最新 100）和日志 |
| PATCH | `/api/admin/mission` | 仅允许修改研究目标说明和首笔收入目标 |
| POST | `/api/admin/opportunities` | 管理员增加具有 HTTPS 来源和公开证据的线索 |
| POST | `/api/admin/discover` | 人工触发一次固定公开源只读扫描 |
| PATCH | `/api/admin/model-mode` | 在端点、模型及密钥全部安全配置后显式开关模型调用 |
| POST | `/api/admin/opportunities/:id/assess` | 使用安全配置的 vLLM 评估机会；否则返回 409 |
| POST | `/api/admin/actions` | 将需批准的行动添加到待审队列 |
| POST | `/api/admin/actions/:id/decision` | 管理员批准或拒绝；不触发实际执行 |

管理接口需要在 Cloudflare 配置 `JUAN_ADMIN_TOKEN` Secret。在未设置或凭据不正确时返回 403。请求头为 `x-juan-admin-token`。此版本不在网页中收集管理员 Token。所有对外有后果的行动都不能绕过人工审批。

示例：在 Cloudflare Secret 已安全设置之后，管理员提交一条线索：

```bash
curl --fail-with-body -X POST 'https://juan-autonomous-agent.nostalgia-ho.workers.dev/api/admin/opportunities' \
  -H "x-juan-admin-token: $JUAN_ADMIN_TOKEN" -H 'content-type: application/json' \
  --data '{"title":"Public business request with identifiable scope","sourceUrl":"https://example.com/public-need","buyerSignal":"Public request from a potential buyer, with details to verify","hypothesis":"Offer a fixed-scope paid pilot after validating their budget"}'
```

`$JUAN_ADMIN_TOKEN` 必须来自私有环境变量或密码管理器，禁止将真实值写进命令历史、截图、GitHub 或前端脚本。

## 数据设计

- `settings`：Juan 的长期使命和权限状态。
- `events`：持续唤醒和变更日志，保留最新 1000 项。
- `ledger`：真实收入和费用的凭证引用，未接收真实交易前保持空表。
- `opportunities`：去重的公开需求线索、来源、评估草案；初始状态为 `unverified`。
- `approvals`：待审操作及人工决定，不代表操作已经执行。
- `last_public_scan` 设置：控制公开源扫描间隔；外部搜索 API 故障时保持下一次唤醒。

每次部署会保留已有 SQLite 状态，禁止将真实记录重新初始化为演示数据。

## Cloudflare 资源

- Worker：`juan-autonomous-agent`
- Durable Object 类：`JuanCore`，绑定：`JUAN_CORE`
- Durable Object 迁移：`v1` / `new_sqlite_classes: ["JuanCore"]`
- 兼容性日期：`2026-11-24`
- 模块入口：`src/worker.mjs`，同时包含 `src/domain.mjs`、`src/discovery.mjs`、`src/model.mjs`
- 声明式部署配置：`wrangler.jsonc`

这是独立部署，不连接也不修改现有 Radar、双喜或逻辑 B 的任何资源。

## 测试

```bash
npm test
```

## 下一阶段

1. 为云端 vLLM 提供可信 HTTPS 端点（建议带域名的反向代理和证书），并**撤销旧脚本里的明文 API Key**。
2. 在 Cloudflare Worker Secrets 配置 `JUAN_ADMIN_TOKEN`、`JUAN_VLLM_API_KEY`，在私有配置中设置 `JUAN_VLLM_BASE_URL`、`JUAN_VLLM_MODEL`，前者必须以 `https://` 开头。所有配置不提交仓库。
3. 从私有管理入口验证模型 `/v1/chat/completions` 的格式与限流，再调用 `PATCH /api/admin/model-mode` 设置 `{ "enabled": true }`；默认仍为 `false`。
4. 让 Juan 依据线索提出具体、可证伪的服务报价与试验方案；建立客户外联前的人工审核及第三方平台使用条款核验。
5. 建立真实客户支付与凭证核对流程，再开放相应业务权限。现有 GPU 推理视作边际计价为 ¥0 的试点假设，不能当作总成本为零。

## 安全边界

项目代码和 GitHub 仓库不得存储明文凭据、私人客户数据或云服务器的旧 API Key。Juan 不拥有修改自身预算上限、规则或授权边界的权限。模型回复及搜索结果均按不可信数据处理；批准记录不能代替实际执行授权。公开源采集每 6 小时一次，频率和存储设硬上限。需遵守信息源条款，并避免把公开评论误判为成交意向。
