# Juan — Autonomous Business Agent

Juan 是一个基于 Cloudflare Worker + Durable Object 的自主创业 Agent 项目，目标是在明确授权和预算边界内，自主研究真实付费机会，验证业务假设，并记录可核对的商业结果。

## 目前版本：0.4.0（任务驱动 + PayPal 收款底座）

已实现：

- 独立 Worker 的只读控制台与健康检查。
- SQLite-backed Durable Object，持久保存使命、事件和财务记录表。
- **移除固定 15 分钟心跳**。队列有任务时立即处理完一条接下一条，队列空时不运行空转循环；失败退避 5 分钟。Cloudflare Worker 不承诺常驻无限运行，连续任务通过 Durable Object 工作事件接力完成。
- 每 6 小时从固定的 [HN Algolia Search API](https://hn.algolia.com/api) 读取近期公开评论，提取**未经验证的需求线索**；HTTPS 来源链接、原文片段和初步假设存入 SQLite，自动去重，最多保留 500 条。
- 模型适配器：兼容 OpenAI Chat Completions 格式，默认强制 HTTPS、禁止重定向、90 秒推理超时控制、严格解析机会评估 JSON。仅在所有者明确授权并配置 `JUAN_ALLOW_HTTP_VLLM=true` 时允许不加密 HTTP，风险见下文。
- 机会池和行动审批队列：记录待审、批准、拒绝状态；即使批准，当前版本也**没有对外执行器**。
- 每条新线索自动创建持久化 `assess-opportunity` 任务；在管理员明确启用模型之前，任务只排队。启用后按任务接力执行，最多 20 次模型尝试/UTC 日、每条最多 3 次尝试。
- 若缺乏买家或可售服务证据，评估保留 `normalizedMissingFields` 并降低置信度；缺失至少两项时标记 `insufficientEvidence=true`，不强迫模型编造客户或订单。
- 公开接口仅返回经过裁剪的安全状态；管理接口默认锁定。
- 首笔收入目标 ¥1；实际到账收入初始化为 ¥0，绝不生成虚构收款。
- 默认关闭：大模型调用、对外互动、付费操作、任何未授权工具执行。
- vLLM 主模型预留为后续接入目标；不包含服务器地址或 API Key。
- PayPal Orders v2 服务端收款：人工创建服务报价并决定是否上架；买家从 `/buy` 跳转 PayPal；返回后服务端向 PayPal 捕获付款。只有确切的 `PAYMENT.CAPTURE.COMPLETED` 验签事件或 PayPal Capture API 返回匹配订单、美元金额和 `COMPLETED` 状态，才能标记为已捕获。
- 订单、报价、付款事件保存在同一个 SQLite Durable Object 中。付款事件以 PayPal 事件 ID 去重，捕获请求有固定 `PayPal-Request-Id`，订单有基础限流（每客户每小时最多五单，全球每天最多 200 单）。
- 退款通知（包括部分退款）单独记账；美元捕获毛额与退款美元额分列，不与人民币目标相加。退款、履约、外联和采购没有自动执行权限。
- 收款连接默认 **关闭**；必须配置 PayPal 正式或沙盒应用的 Client ID、Secret、Webhook ID 和模式才能激活报价。仓库不含任何支付密钥，初始无商品、无订单。

尚未实现：客户接洽、自动服务交付、税务发票、商户 KYC/争议自动处理。当前代码完成的是收款**接口**，没有 PayPal API 凭据便无法进行真实收款。公开信息采集和模型评估不意味着找到付费客户或已获得收入。

## 接口

| HTTP | 路径 | 内容 |
| --- | --- | --- |
| GET | `/` | 状态控制台（公开且无敏感信息） |
| GET | `/health` | Worker 健康状态 |
| GET | `/api/status` | Durable Object 持久状态摘要 |
| GET | `/buy` | 仅展示人工已上架的服务，提供 PayPal 跳转结账入口 |
| GET | `/api/offers` | 公开可购买的服务报价，不包含草稿 |
| POST | `/api/checkout` | 对已上架服务创建 PayPal 订单，参数 `{ "offerId": 1 }` |
| GET | `/api/checkout/:uuid` | 查询订单公开状态，仅 UUID 持有者可以查到 |
| POST | `/api/checkout/:uuid/capture` | 买家 PayPal 授权返回后，由服务器捕获并验证付款 |
| POST | `/api/paypal/webhook` | 接受并向 PayPal 验签的支付通知 |
| GET | `/api/admin/state` | 管理员私有状态、机会池（最新 100）、审批队列（最新 100）和日志 |
| POST | `/api/admin/offers` | 创建草稿报价，必填 `title`、`description`、整数 `priceUsdCents` |
| PATCH | `/api/admin/offers/:id` | 人工把草稿上架或下架 `{ "status": "active" }` |
| PATCH | `/api/admin/mission` | 仅允许修改研究目标说明和首笔收入目标 |
| POST | `/api/admin/opportunities` | 管理员增加具有 HTTPS 来源和公开证据的线索 |
| POST | `/api/admin/discover` | 人工触发一次固定公开源只读扫描 |
| PATCH | `/api/admin/model-mode` | 在端点、模型及密钥配置后显式开关模型调用 |
| GET | `/api/admin/model-probe` | 只请求模型服务 `/v1/models`，返回连通性、HTTP 状态和耗时，不跑推理 |
| POST | `/api/admin/opportunities/:id/assess` | 使用安全配置的 vLLM 评估机会；否则返回 409 |
| POST | `/api/admin/actions` | 将需批准的行动添加到待审队列 |
| POST | `/api/admin/actions/:id/decision` | 管理员批准或拒绝；不触发实际执行 |
| POST | `/api/admin/tasks/:id/retry` | 管理员手动重新排队失败任务，清零该任务重试计数 |

管理接口需要在 Cloudflare 配置 `JUAN_ADMIN_TOKEN` Secret。在未设置或凭据不正确时返回 403。请求头为 `x-juan-admin-token`。此版本不在网页中收集管理员 Token。所有对外有后果的行动都不能绕过人工审批。

示例：在 Cloudflare Secret 已安全设置之后，管理员提交一条线索：

```bash
curl --fail-with-body -X POST 'https://juan-autonomous-agent.nostalgia-ho.workers.dev/api/admin/opportunities' \
  -H "x-juan-admin-token: $JUAN_ADMIN_TOKEN" -H 'content-type: application/json' \
  --data '{"title":"Public business request with identifiable scope","sourceUrl":"https://example.com/public-need","buyerSignal":"Public request from a potential buyer, with details to verify","hypothesis":"Offer a fixed-scope paid pilot after validating their budget"}'
```

`$JUAN_ADMIN_TOKEN` 必须来自私有环境变量或密码管理器，禁止将真实值写进命令历史、截图、GitHub 或前端脚本。

## PayPal 收款配置

1. 在 [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/) 为自己的收款商户账户创建 REST 应用，先用 Sandbox 模式；查看 `Client ID` 与 `Secret`。账号是否有资格接收商户 API 付款取决于其地区和账户类型，必须由 PayPal 实际接口验证。个人账户电子邮箱不等于 API 授权。
2. 为该应用登记 Webhook 地址：`https://juan-autonomous-agent.nostalgia-ho.workers.dev/api/paypal/webhook`。至少订阅 `PAYMENT.CAPTURE.COMPLETED`、`PAYMENT.CAPTURE.REFUNDED`、`PAYMENT.CAPTURE.REVERSED`；可额外订阅 `PAYMENT.CAPTURE.PENDING` 和 `PAYMENT.CAPTURE.DENIED` 用于审计，但后两者不会使订单变为已付款。复制此 Webhook 的 ID，它不是 Client ID。
3. 到 Cloudflare Dashboard → `juan-autonomous-agent` → Settings → Variables and Secrets，将以下字段**作为 Secret** 设置，不要提交到仓库：

   | Secret | 内容 |
   | --- | --- |
   | `JUAN_PAYPAL_MODE` | `sandbox`（测试）或 `live`（正式） |
   | `JUAN_PAYPAL_CLIENT_ID` | 对应模式的 REST 应用 Client ID |
   | `JUAN_PAYPAL_CLIENT_SECRET` | 对应模式的 REST 应用 Secret |
   | `JUAN_PAYPAL_WEBHOOK_ID` | 为上面的回调 URL 订阅的 Webhook ID |

   模式和凭据必须来自**同一 PayPal 环境**，PayPal API 只走固定 HTTPS 官方域名。缺任意一项时 `/api/checkout` 返回 `503`；`/api/status` 的 `commerce.paypal.checkoutReady` 为 `false`。
4. 用管理员接口创建一项真实可交付的服务（初始为 `draft`），核对价格、商品描述、退款政策后，**人工** `PATCH` 为 `active`。这一步才会让 `/buy` 对外显示可购买项目。不要把模型生成的研究假设直接上架。
5. 用 Sandbox 买家账户走一遍：下单 → PayPal 授权 → 返回 `/checkout/return` → 服务端捕获 → 检查管理员订单与 PayPal 商户记录一致。成功捕获的状态是 `captured`；`pending` 不允许履约。测试退款及重复 Webhook。正式上线前把同一配置切换为 Live，使用 Live 的 Client ID、Secret 和 Webhook ID，再核对支付政策与交付能力。

`grossCapturedUsdCents` 表示 PayPal 已确认**捕获毛额**，`refundedUsdCents` 单独记录；两者都不是银行实际结算金额，也不应直接替换 `verifiedRevenueCny`。所有手续费、汇率、拒付和税务需要另行核算。不要自动退款或自动发货。

## 数据设计

- `settings`：Juan 的长期使命和权限状态。
- `events`：研究、任务执行和变更日志，保留最新 1000 项。
- `ledger`：真实收入和费用的凭证引用，未接收真实交易前保持空表。
- `opportunities`：去重的公开需求线索、来源、评估草案；初始状态为 `unverified`。
- `tasks`：独立评估任务及排队、运行、完成、失败状态，超时状态可恢复。
- `approvals`：待审操作及人工决定，不代表操作已经执行。
- `offers`：人工创建和激活的服务及固定美元报价；定价单位为整数美分。
- `orders`：本地 UUID 订单、PayPal 订单 ID/捕获 ID、状态、毛额和退款额。没有持卡人信息。
- `payment_events`：验签通过的 PayPal 事件去重与处理结果。
- `last_public_scan` 设置：控制公开源扫描间隔；单独的六小时 Cron 只负责公开源同步。

每次部署会保留已有 SQLite 状态，禁止将真实记录重新初始化为演示数据。

## Cloudflare 资源

- Worker：`juan-autonomous-agent`
- Durable Object 类：`JuanCore`，绑定：`JUAN_CORE`
- Durable Object 迁移：`v1` / `new_sqlite_classes: ["JuanCore"]`
- 兼容性日期：`2026-11-24`
- 模块入口：`src/worker.mjs`，同时包含 `src/domain.mjs`、`src/discovery.mjs`、`src/model.mjs`、`src/paypal.mjs`
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
5. 在真实 PayPal 账户配置并完成沙盒端到端测试后，再批准一项具体服务上架。实现持续的退款/争议对账、交付与税务凭据。现有 GPU 推理视作边际计价为 ¥0 的试点假设，不能当作总成本为零。

## 安全边界

项目代码和 GitHub 仓库不得存储明文凭据、私人客户数据或云服务器的旧 API Key。Juan 不拥有修改自身预算上限、规则或授权边界的权限。模型回复及搜索结果均按不可信数据处理；批准记录不能代替实际执行授权。公开源采集每 6 小时一次，频率和存储设硬上限。需遵守信息源条款，并避免把公开评论误判为成交意向。

**HTTP 传输警告**：在 HTTP 模式下，Worker 到云服务器的 Bearer API Key 和任务文本在网络上不受 TLS 加密保护。云服务器由本人拥有，不等于两者之间的链路安全。此模式为所有者明确授权的过渡方案，必须尽快换成 HTTPS 并轮换 API Key。不要把这项开关作为默认公开部署模板。

**PayPal 特别边界**：Webhook 消息必须由 PayPal 验签，未签名的 HTTP 请求和订单返回页面都不能认定付款成功。支付能力与 vLLM 权限严格分离；LLM 无法访问收款 Secret、激活商品或修改金额。新接口只适合人工审定的固定范围无实物服务；交易争议与退款需要商户人工处理。
