# dsh-fullstack-expert

给 DeepSeek Harness（dsh）用的「全栈工程专家」组合包：常驻工程准则 + 技术栈探测工具 + 前端 / 后端 / 数据库 / 部署四个 Skill。

## 它贡献了什么

| 能力 | 实现 | 位置 |
|---|---|---|
| 常驻人设（工程准则） | `ctx.systemPrompt.section({ order: 1 })` | `src/index.ts` |
| 工程流程引导 | `ctx.systemPrompt.section({ order: 450 })` | `src/index.ts` |
| `stack_probe` 技术栈探测（只读） | 原始 `ToolDefinition` → `ctx.tools.register` | `src/index.ts` |
| 四个分层 Skill | `ctx.skills.register`（运行时注册） | `skills/*/SKILL.md` |

Skill 由插件自己注册进 `ctx.skills`，不需要改 `skill-filesystem` 配置。组合里没有 skills 服务时（例如极简 profile），插件照常加载，只是不注册 Skill。

## 安装

前置：dsh `0.2.x`（Node 要求见 dsh 自身：`^24.22.3 || >=26`）。

仓库已提交构建产物 `lib/index.js`，从 GitHub 安装不需要 `prepare` 构建授权：

```sh
dsh plugin --profile web add github:OWNER/dsh-fullstack-expert
dsh --profile web --dump-config   # 应出现 "# == dsh-fullstack-expert" 层
dsh --profile web                 # → http://127.0.0.1:3080
```

终端出现 `[fullstack-expert] plugin loaded` 即加载成功。卸载：

```sh
dsh plugin --profile web remove dsh-fullstack-expert
```

本地目录也可以直接装成组合包，装完后会出现在 Web 侧边栏的「插件」页，可开关：

```sh
dsh plugin --profile web add /Users/zhua/Doubao/chats/2026-11-23/new-chat/dsh-fullstack-expert
```

装成组合包后不要再叠加 `dev.patch.yml`，否则同一插件会被加载两次。

## 本地调试（不装成包）

插件运行时只依赖 Node 内置模块，从任意绝对路径都能通过 `--patch` 加载：

```sh
# 直接用已提交的构建产物启动，不需要 npm install
dsh --profile web --patch /Users/zhua/Doubao/chats/2026-11-23/new-chat/dsh-fullstack-expert/dev.patch.yml --no-open
```

launcher 参数要写在 app 名之前（`dsh --profile web --patch ...`），写成 `dsh web --no-open --patch ...` 会报 unknown option。

如果 dsh 自身的家目录不可写（例如沙箱环境），指定一个可写的 `DSH_HOME`：

```sh
DSH_HOME=/tmp/dsh-home dsh --profile web --patch .../dev.patch.yml --no-open
```

终端出现 `[fullstack-expert] plugin loaded` 即加载成功。首次对话前需要在 Web 的 Models 页面填入
DeepSeek API Key（或在启动环境里导出 `DEEPSEEK_API_KEY`），否则 headless/对话会报 `MISSING_CREDENTIAL`。

改了 `src/index.ts` 后重新构建（这一步需要 `npm install` 装开发依赖）：

```sh
npm install && npm run build
```

换目录或换机器时，改 `dev.patch.yml` 里的绝对路径。

## 可选：会话级 preset

默认安装后对**所有**会话生效。若只想在选定会话里启用，把
[agent.cordis.yml](config/agent-presets/fullstack/agent.cordis.yml) 的内容追加到 profile 的
`cordis.patch.yml`，然后在 Web UI 的 Agent 预设选择器里选「全栈专家」。

该 preset 的工具清单按 dsh 0.2.x 的包名编写；升级 dsh 后请对照官方的
`packages/bundle/web-app/presets/standard.patch.yml` 同步。

## 目录

```
dsh-fullstack-expert/
├─ package.json            # dsh.bundle 声明 + peer/dev 依赖
├─ cordis.patch.yml        # 组合包层（按包名引用插件）
├─ dev.patch.yml           # 本地调试层（绝对路径，不随包发布）
├─ tsconfig.json
├─ src/index.ts            # 插件源码
├─ lib/index.js            # 构建产物（提交进仓库，GitHub 安装直接可用）
├─ skills/{frontend,backend,database,deploy}/SKILL.md
└─ config/agent-presets/fullstack/   # 可选 preset 片段
```

## 调试与自检

- 类型校验：`npm run typecheck`（需要先 `npm install`）。
- 改了 `src/index.ts` 后必须 `npm run build` 并提交 `lib/`，否则安装到的仍是旧产物。
- 加载失败先看终端：`inject` 漏写会报 `ctx.tools` / `ctx.systemPrompt` 未解析。
- 工具重名会直接失败；新增工具请保持 `stack_probe` 这类前缀命名。
- 人设与流程段会被写进系统提示词前缀：不要把时间、git 状态、目录列表之类动态内容塞进 `section`，否则每轮都会击穿 KV cache。需要动态事实时让模型调用 `stack_probe`。

## 版本适配

- 面向 dsh `0.2.2-rc.5` 开发，`engines.dsh` 限制在 `>=0.2.0 <0.3.0`。
- 使用的公开契约：`ctx.systemPrompt.section`、`ctx.tools.register`（原始 `ToolDefinition`）、
  `ctx.skills.register`、`dsh.bundle.patch`。
