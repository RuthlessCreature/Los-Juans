# Juan — Autonomous Business Agent

Juan 是一个基于 Cloudflare Worker + Durable Object 的自主创业 Agent 项目，目标是在明确授权和预算边界内，自主研究真实付费机会，验证业务假设，并记录可核对的商业结果。

## 目前版本：0.3.0（任务驱动版）

已实现：

- 独立 Worker 的只读控制台与健康检查。
- SQLite-backed Durable Object，持久保存使命、事件和财务记录表。
- **移除固定 15 分钟心跳**。队列有任务时立即处理完一条接下一条，队列空时不运行空转循环；失败退避 5 分钟。Cloudflare Worker 不承诺常驻无限运行，连续任务通过 Durable Object 工作事件接力完成。
- 每 6 小时从固定的 [HN Algolia Search API](https://hn.algolia.com/api) 读取近期公开评论，提取**未经验证的需求线索**；HTTPS 来源链接、原文片段和初步假设存入 SQLite，自动去重，最多保留 500 条。
- 模型适配器：兼容 OpenAI Chat Completions 格式，默认强制 HTTPS、禁止重定向、90 秒推理超时控制、严格解析机会评估 JSON。仅在所有者明确授权并配置 `JUAN_ALLOW_HTTP_VLLM=true` 时允许不加密 HTTP，风险见下文。
- 机会池和行动审批队列：记录待审、批准、拒绝状态；即使批准，当前版本也**没有对外执行器**。
- 每条新线索自动创建持久化 `assess-opportunity` 任务；在管理员明确启用模型之前，任务只排队。启用后按任务接力执行，最多 20 次模型尝试/UTC 日、每条最多 3 次尝试。
- 公开接口仅返回经过裁剪的安全状态；管理接口默认锁定。
- 首笔收入目标 ¥1；实际到账收入初始化为 ¥0，绝不生成虚构收款。
- 默认关闭：大模型调用、对外互动、付费操作、任何未授权工具执行。
- vLLM 主模型预留为后续接入目标；不包含服务器地址或 API Key。

尚未实现：客户接洽、付款渠道及成交验证。当前公开信息采集和模型评估不意味着具备自主意识、找到付费客户或已获得收入。线索可能是噪音，必须后续核实。

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
| PATCH | `/api/admin/model-mode` | 在端点、模型及密钥配置后显式开关模型调用 |
| GET | `/api/admin/model-probe` | 只请求模型服务 `/v1/models`，返回连通性、HTTP 状态和耗时，不跑推理 |
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
- `events`：研究、任务执行和变更日志，保留最新 1000 项。
- `ledger`：真实收入和费用的凭证引用，未接收真实交易前保持空表。
- `opportunities`：去重的公开需求线索、来源、评估草案；初始状态为 `unverified`。
- `tasks`：独立评估任务及排队、运行、完成、失败状态，超时状态可恢复。
- `approvals`：待审操作及人工决定，不代表操作已经执行。
- `last_public_scan` 设置：控制公开源扫描间隔；单独的六小时 Cron 只负责公开源同步。

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

1. 最终将云端 vLLM 升级为可信 HTTPS（建议带域名的反向代理和证书），并轮换旧脚本里的明文 API Key。
2. 在 Cloudflare Worker Secrets 配置 `JUAN_ADMIN_TOKEN`、`JUAN_VLLM_API_KEY`、`JUAN_VLLM_BASE_URL`、`JUAN_VLLM_MODEL`。所有配置不提交仓库。只有明确开启 `JUAN_ALLOW_HTTP_VLLM=true` 才能使用当前 HTTP 地址。
3. 从私有管理入口验证模型 `/v1/chat/completions` 的格式与限流，再调用 `PATCH /api/admin/model-mode` 设置 `{ "enabled": true }`。
4. 让 Juan 依据线索提出具体、可证伪的服务报价与试验方案；建立客户外联前的人工审核及第三方平台使用条款核验。
5. 建立真实客户支付与凭证核对流程，再开放相应业务权限。现有 GPU 推理视作边际计价为 ¥0 的试点假设，不能当作总成本为零。

## 安全边界

项目代码和 GitHub 仓库不得存储明文凭据、私人客户数据或云服务器的旧 API Key。Juan 不拥有修改自身预算上限、规则或授权边界的权限。模型回复及搜索结果均按不可信数据处理；批准记录不能代替实际执行授权。公开源采集每 6 小时一次，频率和存储设硬上限。需遵守信息源条款，并避免把公开评论误判为成交意向。

**HTTP 传输警告**：在 HTTP 模式下，Worker 到云服务器的 Bearer API Key 和任务文本在网络上不受 TLS 加密保护。云服务器由本人拥有，不等于两者之间的链路安全。此模式为所有者明确授权的过渡方案，必须尽快换成 HTTPS 并轮换 API Key。不要把这项开关作为默认公开部署模板。
