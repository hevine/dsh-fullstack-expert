# dsh-fullstack-expert

给 DeepSeek Harness（dsh）用的「全栈工程专家」组合包：常驻工程准则 + 技术栈探测 + 仓库规约抽取 + 仓库项目规则 + 可验证的只读检查 + 前端 / 后端 / 数据库 / 部署四个 Skill。

## 它贡献了什么

| 能力 | 实现 | 位置 |
|---|---|---|
| 常驻人设（工程准则） | `ctx.systemPrompt.section({ order: 1 })` | `src/index.ts` |
| 工程流程引导 | `ctx.systemPrompt.section({ order: 450 })` | `src/index.ts` |
| `stack_probe` 技术栈探测（只读） | 原始 `ToolDefinition` → `ctx.tools.register` | `src/index.ts` |
| `repo_conventions` 仓库规约抽取（只读） | 同上 | `src/index.ts` |
| `repo_guidelines` 仓库项目规则读取（只读） | 同上；只读 `.dsh/skills/*/SKILL.md` | `src/index.ts` |
| `run_checks` 只读检查执行 | 同上；只跑项目声明的 lint/typecheck/test | `src/index.ts` |
| 四个分层 Skill | `ctx.skills.register`（运行时注册） | `skills/*/SKILL.md` |

Skill 由插件自己注册进 `ctx.skills`，不需要改 `skill-filesystem` 配置。组合里没有 skills 服务时（例如极简 profile），插件照常加载，只是不注册 Skill。

## 四个工具

| 工具 | 作用 | 副作用 |
|---|---|---|
| `stack_probe` | 语言、框架、子项目、lint/test 命令、Makefile 目标、CI、容器 | 只读 |
| `repo_conventions` | 命名风格、测试位置、配置清单、`.env` 变量名、Git 提交风格、建议先读文件 | 只读（含 `git log`） |
| `repo_guidelines` | 读取仓库根 `.dsh/skills/*/SKILL.md` 的项目规则，可按 `topic` 过滤 | 只读 |
| `run_checks` | 跑项目声明的 lint / typecheck / test / build，返回状态、退出码、耗时与输出尾部 | lint/typecheck/test 只读；build 写产物，需显式请求 |

`run_checks` 的命令来源只有四种，不接受任意命令：

1. `package.json` 的 `lint` / `typecheck` / `test` / `build` 脚本；
2. 项目内 `node_modules/.bin/tsc --noEmit`（有 `tsconfig.json` 且未声明 typecheck 脚本时兜底，不产出文件）；
3. `go vet ./...`、`go test ./...`、`go build ./...`；
4. Makefile 的 `build` 目标（存在时优先，视为多栈仓库的完整构建入口，且不再重复跑子项目 build）。

`build` 会写产物、可能触发项目自己的依赖安装，因此不在默认检查里；传 `checks: ["build"]` 才执行。传 `dryRun: true` 只列出将要执行的命令、不实际运行。

试点仓库（lingua-ops：Go 单二进制 + React 前端）实测：

```
[✓ passed] .   lint      go vet ./...       0.8s
[✓ passed] web typecheck tsc --noEmit        1.8s
[✓ passed] .   test      go test ./...       2.3s
```

### 前端产物新鲜度（只读）

`repo_conventions` 会扫描 `//go:embed` 目录，再用 `vite.config.*` 的 `outDir` 反查出对应的前端项目，比较源码最新 mtime 与产物时间：

```
产物新鲜度：
- web/src → internal/webui/dist：stale（源码 2026-11-23 13:28:21 晚于产物 2026-11-23 10:40:03）
注意：web/src 比 internal/webui/dist 新，需重建前端，否则二进制里仍是旧 UI
```

`run_checks` 也会在结果说明里带上同样的提醒，避免「前端改了、二进制里还是旧 UI」。整个检查只读，不执行构建。

## 项目规则住进仓库

插件不内置任何具体仓库的业务规则。仓库自己的约定放在仓库根的 `.dsh/skills/<topic>/SKILL.md`，跟随 git 走：

```
<repo>/.dsh/skills/api-contract/SKILL.md
```

模型在动手前调用 `repo_guidelines`，工具结果里会带上命中的规则正文：

- 只读 `.dsh/skills/`，不把仓库里的任意文件当成指令；
- 传 `topic`（如 `api`、`frontend`）按名称、描述、`appliesTo` 与正文过滤；
- 单次返回上限 20KB，超出会截断并提示直接读文件；
- 未命中时明确返回「该仓库未定义项目规则」，模型退回通用 Skill，而不是沿用别的仓库假设。

规则写法用 [templates/repo-skill.md](templates/repo-skill.md)：frontmatter 里的 `name` / `description` / `appliesTo`，正文固定为 **不变量 / 必读文件 / 完成标准** 三段。试点仓库 lingua-ops 的样板在 `.dsh/skills/api-contract/SKILL.md`。

为什么不用 `ctx.skills.register` 注册项目 skill：那是进程级全局注册，一个会话切换多个仓库时，A 仓库的规则会污染 B 仓库。工具结果注入天然按调用作用域生效。

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
├─ templates/repo-skill.md  # 仓库项目规则模板（不变量 / 必读文件 / 完成标准）
└─ config/agent-presets/fullstack/   # 可选 preset 片段
```

## 调试与自检

- 类型校验：`npm run typecheck`（需要先 `npm install`）。
- 改了 `src/index.ts` 后必须 `npm run build` 并提交 `lib/`，否则安装到的仍是旧产物。
- 加载失败先看终端：`inject` 漏写会报 `ctx.tools` / `ctx.systemPrompt` 未解析。
- 工具重名会直接失败；新增工具请保持 `stack_probe` / `repo_guidelines` 这类清晰命名，并在 `description` 里写清是否有副作用与读取范围。
- `run_checks` 会把 `exec.signal` 透传给子进程（SIGTERM，2 秒后 SIGKILL），并声明 `timeoutMs: 600000` 支持协作取消。
- 人设与流程段会被写进系统提示词前缀：不要把时间、git 状态、目录列表之类动态内容塞进 `section`，否则每轮都会击穿 KV cache。需要动态事实时让模型调用 `stack_probe`。

## 版本适配

- 面向 dsh `0.2.2-rc.5` 开发，`engines.dsh` 限制在 `>=0.2.0 <0.3.0`。
- 使用的公开契约：`ctx.systemPrompt.section`、`ctx.tools.register`（原始 `ToolDefinition`）、
  `ctx.skills.register`、`dsh.bundle.patch`。
