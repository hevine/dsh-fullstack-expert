# dsh-fullstack-expert 迭代规划

> 状态：草案，待评审  
> 基线版本：v0.3.0  
> 最后更新：2026-11-23

## 1. 现状（v0.3.0）

### 已有能力

| 能力 | 实现 | 性质 |
|---|---|---|
| 常驻工程准则 | `systemPrompt.section`（persona / workflow） | 静态提示 |
| 技术栈探测 | `stack_probe`：多项目、框架、命令、Makefile 目标、CI、容器 | 只读 |
| 仓库规约抽取 | `repo_conventions`：目录、命名、测试位置、配置、Git 风格、建议先读文件 | 只读 |
| 产物新鲜度 | 从 `//go:embed` 反查 vite `outDir`，比较源码与产物 mtime | 只读 |
| 检查执行 | `run_checks`：lint / typecheck / test / build，支持 `dryRun` | 前 3 项只读，build 写产物 |
| 分层规则 | frontend / backend / database / deploy 四个通用 skill | 通用知识 |

### 已验证

- lingua-ops（Go 单二进制 + React）：`go vet`、`tsc --noEmit`、`go test` 全部真实通过。
- 产物新鲜度能发现 `web/src` 比 `internal/webui/dist` 新。
- `make build` 链路在 `/tmp` fixture 上真实验证；Makefile build 优先且不重复跑子项目。

### 已知缺口

1. ~~skill 仍是通用知识，不懂具体仓库的接口映射与业务不变量。~~ v0.4 已用 `repo_guidelines` 覆盖。
2. 没有改动前的影响面分析，也没有改动后的自审。
3. 没有评估基线，"更好"无法量化。
4. GitHub 安装尚未验证（网络受限）。

---

## 2. 设计原则

1. **能力与知识分离**：插件提供探测、执行、校验、抽取的方法；仓库事实留在仓库里。
2. **知识按作用域**：项目规则不写进插件包，避免换仓库后带着旧假设干活。
3. **工具优先于规则**：能写成检查的，不写成建议。检查会阻断，建议会被忽略。
4. **注入时机优先于知识量**：上下文越长，注意力越稀释；知识必须按需加载。
5. **默认安全**：有副作用的操作（build、安装）必须显式请求。

---

## 3. 总览

| 版本 | 主题 | 目标 | 状态 |
|---|---|---|---|
| v0.4 | 项目知识住进仓库 | 换仓库零污染，规则跟随 git | 已实现 |
| v0.5 | 影响面与自审 | 改前知道谁在用，改后知道哪没验 | 待评审 |
| v0.6 | 评估基线 | 用数据证明可靠性提升 | 待评审 |
| v1.0 | 分发与维护 | 干净机器一条命令装好 | 待评审 |

---

## 4. v0.4 · 项目知识住进仓库

### 目标

让"这个仓库的规矩"能被模型在正确的时刻读到，同时不让插件积累任何特定仓库的知识。

### 交付物

1. **新工具 `repo_guidelines`**
   - 参数：`{ path?, topic? }`
   - 读取仓库根 `.dsh/skills/*/SKILL.md`，按 `topic` 过滤，返回命中规则的正文
   - 只读，单次返回上限 20KB；无命中时明确返回"该仓库未定义项目规则"

   返回结构（草案）：

   ```json
   {
     "root": "/path/to/repo",
     "matched": [
       { "name": "api-contract", "description": "...", "content": "...", "path": ".dsh/skills/api-contract/SKILL.md" }
     ],
     "notes": ["未定义 topic=telemetry 的规则，已退回通用 skill"]
   }
   ```

2. **规则模板** `templates/repo-skill.md`
   - frontmatter：`name` / `description` / `appliesTo`（路径或信号）
   - 正文三段式：**不变量** / **必读文件** / **完成标准**

3. **样板**：在 lingua-ops 写 `.dsh/skills/api-contract/SKILL.md`
   - 核心内容：改 `/api/*` 时同步 `internal/api`、`web/src/api/types.ts`、`client.ts`、消费页面
   - 完成标准：`run_checks` 的 lint/typecheck/test 全绿 + 一条 curl 示例

4. **workflow 调整**
   - 动手前先调 `repo_guidelines`；无项目规则时退回通用 skill

### 为什么不用全局注册 skill

dsh 的 `ctx.skills.register` 是进程级全局注册，而一个 dsh 会话可能切换多个仓库。全局注册项目 skill 会让 A 仓库的规则污染 B 仓库。工具结果注入天然按调用作用域生效，且能被 `topic` 精确裁剪。

### 验收标准

在 lingua-ops 上执行真实任务：给 `GET /api/services/{id}` 增加一个字段。

- 模型主动调用 `repo_guidelines`；
- 正确改动 Go handler、`types.ts`、`client.ts` 与消费页面；
- `run_checks` 真实通过；
- 不出现"只改了 Go、前端类型没同步"。

### 风险

- `.dsh/skills/` 是自定约定，需要确认是否与 dsh 既有目录规范冲突；
- 规则文件可能被写成又一份 README，需要模板强约束三段式。

---

## 5. v0.5 · 影响面与自审

### 交付物

1. **`impact`（只读）**
   - 参数：`{ path?, symbol, limit? }`
   - 用 `git grep -n -w` 查反向引用，返回文件、行号、片段
   - 明确限制：不是 LSP，无法区分同名符号与动态引用

2. **`diff_review`（只读）**
   - 参数：`{ path?, base? }`
   - 读取 `git diff --name-status`，按路径给出风险项：

   | 改动路径 | 风险提示 |
   |---|---|
   | `web/src/**` 且 `internal/webui/dist` 未变 | 产物未重建，二进制里是旧 UI |
   | `internal/api/**` 且 `web/src/api/**` 未变 | 接口契约可能未同步 |
   | 迁移目录有新增但无 down | 回滚路径缺失 |
   | 只改测试 | 提示确认不是为了让测试变绿而放宽断言 |

3. **`run_checks` 增量模式**
   - 参数：`scope: "changed"`
   - 从 `git diff --name-only` 映射到包：Go 只跑相关包，例如 `go test ./internal/api/...`
   - 前端类型检查不变（全量 `tsc --noEmit`）
   - 映射失败时退回全量，并在结果里说明原因

### 验收标准

- 改一个被多处引用的函数，`impact` 能列出全部调用方；
- 前端改动未重建时，`diff_review` 能报出产物过期；
- `scope: "changed"` 时只跑相关包，且结果与全量一致。

### 风险

- 泛型、反射、动态调用无法被 `git grep` 覆盖，需要在输出里声明边界；
- 增量映射按目录推断，可能漏掉跨包依赖。

---

## 6. v0.6 · 评估基线

### 任务模板（4 个）

1. 给现有 API 增加字段（跨 Go + TS）
2. 修改采集逻辑（涉及 README 中两条 demo 不变量）
3. 新增一个前端页面（涉及路由、导航、样式体系）
4. 接入一个真实服务（涉及 registry、健康检查、依赖）

### 指标

| 指标 | 说明 |
|---|---|
| 一次通过率 | 首轮 `run_checks` 全绿的比例 |
| 误改文件数 | 与任务无关的文件改动数量 |
| 工具调用轮次 | 从开始到完成的总调用数 |
| 返工次数 | 失败后重新修改的次数 |

### 方法

- 对比 v0.3（无项目规则）与 v0.5（有项目规则 + 影响面工具）
- 使用 `/tmp` 副本或 `git worktree`，避免污染真实仓库
- 输出一张对比表，结论写入 README

### 验收标准

能回答："项目规则带来了多少提升，哪类任务提升最大。"

---

## 7. v1.0 · 分发与维护

### 交付物

1. GitHub 安装验证（网络恢复后）
2. CI：push 时跑 `tsc`、构建 `lib/`、跑 smoke
3. dsh 版本适配矩阵（当前 `>=0.2.0 <0.3.0`）
4. CHANGELOG 与 tag
5. 安装文档：`dsh plugin add github:hevine/dsh-fullstack-expert`

### 验收标准

干净机器一条命令安装成功，并完成一次完整的探测 → 规约 → 检查链路。

---

## 8. 明确不做

- 不把任何仓库的业务规则写进插件包
- 不把 build 放进默认检查
- 不为"支持更多语言"写未经验证的命令映射
- 不用 skill 数量衡量插件质量
- 不做自动提交、自动推送等有不可逆副作用的操作

---

## 9. 待决策

1. **规则目录约定**：`.dsh/skills/`、`.agents/skills/`，还是单文件 `AGENTS.md`？
   - 倾向 `.dsh/skills/`：与插件同名体系，支持多主题拆分
2. **项目规则优先级**：与内置通用 skill 冲突时，谁覆盖谁？
   - 倾向项目规则优先，但必须在规则文件里显式声明
3. **评估环境**：真实仓库直接跑，还是 `git worktree` 副本？
   - 倾向 worktree：可丢弃、不污染
4. **是否需要规则缓存**：同一轮多次调用 `repo_guidelines` 是否复用结果？
   - 倾向不缓存：文件很小，缓存会引入失效问题
5. **`repo_guidelines` 的安全边界**：仓库内规则被视为项目约定，是否需要限制只能来自 `.dsh/skills/`？
   - 倾向是：只读该目录，避免任意文件被当成指令

---

## 10. 决策记录

| 日期 | 决策 | 原因 |
|---|---|---|
| 2026-11-23 | 放弃"插件内置项目 skill + 按特征加载" | 会让插件积累仓库知识，换仓库后残留错误假设 |
| 2026-11-23 | `run_checks` 只执行项目声明的入口 | 避免自创命令与不可控副作用 |
| 2026-11-23 | build 优先 Makefile 目标，并跳过子项目重复构建 | Makefile 通常是多栈仓库的完整构建入口 |
| 2026-11-23 | 项目规则目录定为仓库根 `.dsh/skills/<topic>/SKILL.md` | 与插件同名体系，支持多主题拆分，且能随 git 评审 |
| 2026-11-23 | 项目规则与通用 skill 冲突时以项目规则为准 | 规则写进了仓库，说明是这个仓库的显式决定 |
| 2026-11-23 | `repo_guidelines` 只读 `.dsh/skills/` | 避免仓库里的任意文件被当成指令执行 |
| 2026-11-23 | 项目规则经工具结果注入，不用 `ctx.skills.register` | 全局注册会让跨仓库会话串味 |
