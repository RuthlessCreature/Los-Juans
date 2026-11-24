# Juan — Autonomous Business Agent

Juan 是一个基于 Cloudflare Worker + Durable Object 的自主创业 Agent 项目，目标是在明确授权和预算边界内，自主研究真实付费机会，验证业务假设，并记录可核对的商业结果。

## 目前版本：0.1.0（安全空载版）

已实现：

- 独立 Worker 的只读控制台与健康检查。
- SQLite-backed Durable Object，持久保存使命、事件和财务记录表。
- 每 15 分钟一次的自动唤醒（无需持续运行本地进程）。
- 公开接口仅返回经过裁剪的安全状态；管理接口默认锁定。
- 首笔收入目标 ¥1；实际到账收入初始化为 ¥0，绝不生成虚构收款。
- 默认关闭：大模型调用、对外互动、付费操作、任何未授权工具执行。
- vLLM 主模型预留为后续接入目标；不包含服务器地址或 API Key。

尚未实现：连接 vLLM、联网探索、市场机会评分、自主试验、受控审批流程、财务支付渠道。当前版本不能对外营业，也不能声称具有自主意识或已获得收入。

## 接口

| HTTP | 路径 | 内容 |
| --- | --- | --- |
| GET | `/` | 状态控制台（公开且无敏感信息） |
| GET | `/health` | Worker 健康状态 |
| GET | `/api/status` | Durable Object 持久状态摘要 |
| GET | `/api/admin/state` | 管理员私有状态，需要 `x-juan-admin-token` |
| PATCH | `/api/admin/mission` | 仅允许修改研究目标说明和首笔收入目标 |

管理接口需要在 Cloudflare 配置 `JUAN_ADMIN_TOKEN` Secret。在未设置或凭据不正确时返回 403。此版本不在网页中收集管理员 Token。

## 数据设计

- `settings`：Juan 的长期使命和权限状态。
- `events`：持续唤醒和变更日志，保留最新 1000 项。
- `ledger`：真实收入和费用的凭证引用，未接收真实交易前保持空表。

每次部署会保留已有 SQLite 状态，禁止将真实记录重新初始化为演示数据。

## Cloudflare 资源

- Worker：`juan-autonomous-agent`
- Durable Object 类：`JuanCore`，绑定：`JUAN_CORE`
- Durable Object 迁移：`v1` / `new_sqlite_classes: ["JuanCore"]`
- 兼容性日期：`2026-11-24`
- 模块入口：`src/worker.mjs`，同时上传 `src/domain.mjs`

这是独立部署，不连接也不修改现有 Radar、双喜或逻辑 B 的任何资源。

## 测试

```bash
npm test
```

## 下一阶段

1. 为云端 vLLM 提供 HTTPS 端点，并轮换旧脚本里的明文密钥。
2. 在 Secrets 中配置全新的管理密钥和 vLLM 凭据。
3. 验证 `/v1/models`、模型对话、结构化 JSON 及工具调用。
4. 接入只读网页搜索与商业机会研究；开启模型预算门禁和审批队列。
5. 用真实成交凭据校验收入，并独立核算现有 GPU 的分摊成本。

## 安全边界

项目代码和 GitHub 仓库不得存储明文凭据、私人客户数据或云服务器的旧 API Key。Juan 不拥有修改自身预算上限、规则或授权边界的权限。
