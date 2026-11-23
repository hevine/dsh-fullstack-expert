/**
 * dsh-fullstack-expert —— 全栈工程专家（DeepSeek Harness 组合包）
 *
 * 贡献：
 *   1. 常驻人设（systemPrompt.section，order 1，紧随部署人设）
 *   2. 工程流程引导（systemPrompt.section，order 450，先于 plan 策略）
 *   3. stack_probe 工具（技术栈探测，只读）
 *   4. 四个工程 Skill（运行时注册进 ctx.skills，无需额外配置）
 *
 * 构建：npm run build（产物 lib/index.js，GitHub 安装直接可用）
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const name = 'fullstack-expert';
export const inject = ['tools', 'systemPrompt'];
/* ------------------------------ 技术栈探测 ------------------------------ */
const FRONTEND_SIGNALS = {
    next: 'Next.js',
    nuxt: 'Nuxt',
    'react-dom': 'React',
    react: 'React',
    vue: 'Vue',
    '@angular/core': 'Angular',
    '@sveltejs/kit': 'SvelteKit',
    svelte: 'Svelte',
    'solid-js': 'Solid',
    astro: 'Astro',
    vite: 'Vite',
};
const BACKEND_SIGNALS = {
    express: 'Express',
    fastify: 'Fastify',
    koa: 'Koa',
    '@nestjs/core': 'NestJS',
    hono: 'Hono',
    '@hapi/hapi': 'hapi',
    django: 'Django',
    fastapi: 'FastAPI',
    flask: 'Flask',
    sqlalchemy: 'SQLAlchemy',
    'spring-boot': 'Spring Boot',
    gin: 'Gin',
};
const DB_SIGNALS = {
    prisma: 'Prisma',
    '@prisma/client': 'Prisma',
    'drizzle-orm': 'Drizzle',
    typeorm: 'TypeORM',
    sequelize: 'Sequelize',
    mongoose: 'Mongoose',
    knex: 'Knex',
    pg: 'PostgreSQL',
    psycopg2: 'PostgreSQL',
    mysql2: 'MySQL',
    pymysql: 'MySQL',
    'better-sqlite3': 'SQLite',
    sqlite3: 'SQLite',
    ioredis: 'Redis',
    redis: 'Redis',
    pymongo: 'MongoDB',
    alembic: 'Alembic',
};
const TEST_SIGNALS = {
    vitest: 'Vitest',
    jest: 'Jest',
    mocha: 'Mocha',
    '@playwright/test': 'Playwright',
    cypress: 'Cypress',
    pytest: 'pytest',
    nose2: 'nose2',
    junit: 'JUnit',
    rspec: 'RSpec',
};
async function readJson(file, signal) {
    try {
        return JSON.parse(await readFile(file, { encoding: 'utf8', signal }));
    }
    catch (error) {
        if (signal?.aborted)
            throw error;
        return null;
    }
}
async function readText(file, signal) {
    try {
        return await readFile(file, { encoding: 'utf8', signal });
    }
    catch (error) {
        if (signal?.aborted)
            throw error;
        return '';
    }
}
async function listDir(dir) {
    try {
        return await readdir(dir);
    }
    catch {
        return [];
    }
}
/** 从依赖名集合里挑出命中的框架，同名去重 */
function matchKeys(keys, signals) {
    const hits = new Set();
    for (const [key, label] of Object.entries(signals)) {
        if (keys.has(key))
            hits.add(label);
    }
    return [...hits];
}
/** Python 依赖是文本，按「行首包名 + 版本或结束」粗略匹配 */
function matchText(text, signals) {
    const hits = new Set();
    for (const [key, label] of Object.entries(signals)) {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`^\\s*${escaped}\\s*(?:[<>=~!\\[,]|$)`, 'im').test(text))
            hits.add(label);
    }
    return [...hits];
}
function detectPackageManager(root, pkg) {
    const declared = pkg?.packageManager;
    if (typeof declared === 'string' && declared.trim())
        return declared.split('@')[0];
    if (existsSync(path.join(root, 'pnpm-lock.yaml')))
        return 'pnpm';
    if (existsSync(path.join(root, 'yarn.lock')))
        return 'yarn';
    if (existsSync(path.join(root, 'bun.lockb')) || existsSync(path.join(root, 'bun.lock')))
        return 'bun';
    if (existsSync(path.join(root, 'package-lock.json')))
        return 'npm';
    if (existsSync(path.join(root, 'poetry.lock')))
        return 'poetry';
    if (existsSync(path.join(root, 'uv.lock')))
        return 'uv';
    return 'unknown';
}
function pickCommands(scripts, pm) {
    const out = {};
    const runner = pm === 'unknown' ? 'npm' : pm;
    const cands = [
        ['typecheck', ['typecheck', 'type-check', 'tsc']],
        ['lint', ['lint', 'lint:check', 'eslint']],
        ['test', ['test', 'test:unit', 'tests']],
        ['build', ['build', 'compile']],
        ['dev', ['dev', 'start:dev', 'serve']],
    ];
    for (const [label, keys] of cands) {
        for (const key of keys) {
            if (typeof scripts[key] !== 'string')
                continue;
            out[label] = key === 'test' ? `${runner} test` : `${runner} run ${key}`;
            break;
        }
    }
    return out;
}
export async function probeStack(root, signal) {
    signal?.throwIfAborted();
    const notes = [];
    const languages = [];
    const pkg = await readJson(path.join(root, 'package.json'), signal);
    if (pkg)
        languages.push('TypeScript/JavaScript');
    const pyText = (await readText(path.join(root, 'pyproject.toml'), signal)).concat('\n', await readText(path.join(root, 'requirements.txt'), signal));
    if (pyText.trim())
        languages.push('Python');
    if (existsSync(path.join(root, 'go.mod')))
        languages.push('Go');
    if (existsSync(path.join(root, 'Cargo.toml')))
        languages.push('Rust');
    if (existsSync(path.join(root, 'composer.json')))
        languages.push('PHP');
    if (existsSync(path.join(root, 'pom.xml')) || existsSync(path.join(root, 'build.gradle')))
        languages.push('Java/Kotlin');
    if (languages.length === 0)
        notes.push('未在仓库根目录发现主流语言清单文件，请确认 path 是否指向仓库根');
    const nodeKeys = new Set();
    if (pkg) {
        for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
            const deps = pkg[field];
            if (deps && typeof deps === 'object') {
                for (const key of Object.keys(deps))
                    nodeKeys.add(key);
            }
        }
    }
    const pm = detectPackageManager(root, pkg);
    const scripts = pkg?.scripts ?? {};
    const commands = pickCommands(scripts, pm);
    const ci = [];
    const workflows = await listDir(path.join(root, '.github', 'workflows'));
    signal?.throwIfAborted();
    if (workflows.length > 0)
        ci.push(`GitHub Actions (${workflows.length} 个 workflow)`);
    for (const file of ['.gitlab-ci.yml', 'Jenkinsfile', '.circleci/config.yml', 'azure-pipelines.yml']) {
        if (existsSync(path.join(root, file)))
            ci.push(file);
    }
    const containers = [];
    for (const file of [
        'Dockerfile',
        'docker-compose.yml',
        'docker-compose.yaml',
        'compose.yaml',
        'compose.yml',
    ]) {
        if (existsSync(path.join(root, file)))
            containers.push(file);
    }
    if (existsSync(path.join(root, 'k8s')) || existsSync(path.join(root, 'helm')))
        containers.push('k8s/helm 配置');
    const migrations = [];
    for (const dir of ['prisma', 'prisma/migrations', 'migrations', 'db/migrate', 'drizzle', 'alembic']) {
        if (existsSync(path.join(root, dir)))
            migrations.push(dir);
    }
    const monorepo = pkg?.workspaces !== undefined ||
        ['pnpm-workspace.yaml', 'lerna.json', 'nx.json', 'turbo.json'].some((file) => existsSync(path.join(root, file)));
    const frameworks = [
        ...matchKeys(nodeKeys, FRONTEND_SIGNALS),
        ...matchKeys(nodeKeys, BACKEND_SIGNALS),
        ...matchText(pyText, BACKEND_SIGNALS),
    ];
    const databases = [...matchKeys(nodeKeys, DB_SIGNALS), ...matchText(pyText, DB_SIGNALS)];
    const testRunners = [
        ...matchKeys(nodeKeys, TEST_SIGNALS),
        ...matchText(pyText, TEST_SIGNALS),
        ...(existsSync(path.join(root, 'phpunit.xml')) ? ['PHPUnit'] : []),
    ];
    if (!commands.test && testRunners.length > 0)
        notes.push(`检测到 ${testRunners.join('/')}，但 package.json scripts 里没有 test 命令，需手动确认调用方式`);
    if (pkg && typeof scripts.lint !== 'string')
        notes.push('没有声明 lint 脚本，改动前请确认项目实际的静态检查入口');
    if (pm === 'unknown')
        notes.push('未识别包管理器，执行命令前先看 lockfile 或 README');
    return {
        root,
        languages,
        packageManager: pm,
        frameworks: [...new Set(frameworks)],
        databases: [...new Set(databases)],
        testRunners: [...new Set(testRunners)],
        commands,
        ci,
        containers,
        migrations,
        monorepo,
        notes,
    };
}
function renderReport(report) {
    const list = (items) => (items.length > 0 ? items.join('、') : '未检测到');
    const lines = [
        `仓库：${report.root}`,
        `语言：${list(report.languages)}`,
        `包管理器：${report.packageManager}`,
        `框架：${list(report.frameworks)}`,
        `数据库：${list(report.databases)}`,
        `测试：${list(report.testRunners)}`,
        `CI：${list(report.ci)}`,
        `容器：${list(report.containers)}`,
        `迁移目录：${list(report.migrations)}`,
        `Monorepo：${report.monorepo ? '是' : '否'}`,
    ];
    const commands = Object.entries(report.commands);
    lines.push(`可执行命令：${commands.length > 0 ? commands.map(([k, v]) => `${k}=${v}`).join('；') : '未声明'}`);
    if (report.notes.length > 0)
        lines.push(`注意：${report.notes.join('；')}`);
    return lines.join('\n');
}
/* --------------------------------- Skill --------------------------------- */
function parseFrontmatter(file) {
    const raw = readFileSync(file, 'utf8');
    const matched = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
    if (!matched)
        return null;
    const meta = {};
    for (const line of matched[1].split(/\r?\n/)) {
        const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
        if (pair)
            meta[pair[1]] = pair[2].trim();
    }
    const skillName = meta.name;
    const description = meta.description;
    if (!skillName || !description)
        return null;
    return { name: skillName, description, content: matched[2].trim() };
}
function loadSkills(skillsDir) {
    if (!existsSync(skillsDir))
        return [];
    const skills = [];
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory())
            continue;
        const file = path.join(skillsDir, entry.name, 'SKILL.md');
        if (!existsSync(file))
            continue;
        const parsed = parseFrontmatter(file);
        if (!parsed) {
            console.warn(`[fullstack-expert] 跳过无法解析 frontmatter 的 skill：${file}`);
            continue;
        }
        skills.push({
            name: parsed.name,
            description: parsed.description,
            content: parsed.content,
            source: 'bundled',
            provider: 'fullstack-expert',
            path: file,
            resourceBase: { kind: 'directory', path: path.dirname(file) },
        });
    }
    return skills;
}
/* --------------------------------- 插件 --------------------------------- */
export function apply(ctx) {
    // 1) 常驻人设：紧随部署人设（order 0），先于 plan 策略（order 500）
    ctx.systemPrompt.section({
        name: 'fullstack-expert:persona',
        order: 1,
        text: [
            '你是全栈工程专家，对前端、后端、数据库与部署四个层面负责。',
            '工程准则：',
            '- 先读现状再动手：改动前用 stack_probe 与既有代码确认技术栈、命令与约定。',
            '- 遵从既有约定（命名、目录、错误类型、日志、依赖注入），不另起一套。',
            '- 跨层改动先固化契约（类型、schema、API 规格），再动实现。',
            '- 改动保持最小面：不顺手重构无关文件，不引入未经请求的新依赖。',
            '- 完成标准是「可验证」：给出 lint / typecheck / test 的真实输出，失败就如实说明。',
            '回答用简洁的工程语言，结论先行，代码引用标注文件路径。',
        ].join('\n'),
    });
    // 2) 流程引导：先于 plan 策略，plan mode 打开时其规则仍可覆盖本段
    ctx.systemPrompt.section({
        name: 'fullstack-expert:workflow',
        order: 450,
        text: [
            '实现类任务的第一步：调用 stack_probe（可传仓库根的绝对路径）取得语言、包管理器、框架、',
            '数据库、测试框架、lint/test/build 命令、CI 与容器配置。后续命令必须来自探测结果或仓库既有脚本。',
            '按改动领域加载对应 skill 获取该层的动手前检查与完成标准：',
            'frontend（页面、组件、样式、构建）、backend（接口、服务、鉴权、事务）、',
            'database（模型、迁移、索引、回填）、deploy（容器、CI、环境变量、发布与回滚）。',
            '跨层改动按「契约 → 实现 → 迁移 → 部署」顺序推进，并在结束时给出验证命令的实际结果。',
        ].join('\n'),
    });
    // 3) 只读探测工具。直接注册原始 ToolDefinition：不依赖任何 dsh 运行时包，
    //    因此从任意路径 --patch 加载都能工作（参数校验自行负责）。
    const stackProbe = {
        name: 'stack_probe',
        description: '探测仓库技术栈：语言、包管理器、前端/后端框架、数据库与迁移目录、测试框架、lint/test/build 命令、CI 与容器配置。只读，不改动文件。',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: '仓库根目录的绝对路径，省略时使用当前工作目录' },
            },
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    root: { type: 'string' },
                    languages: { type: 'array', items: { type: 'string' } },
                    packageManager: { type: 'string' },
                    frameworks: { type: 'array', items: { type: 'string' } },
                    databases: { type: 'array', items: { type: 'string' } },
                    testRunners: { type: 'array', items: { type: 'string' } },
                    commands: { type: 'object', additionalProperties: true },
                    ci: { type: 'array', items: { type: 'string' } },
                    containers: { type: 'array', items: { type: 'string' } },
                    migrations: { type: 'array', items: { type: 'string' } },
                    monorepo: { type: 'boolean' },
                    notes: { type: 'array', items: { type: 'string' } },
                },
                required: [
                    'root',
                    'languages',
                    'packageManager',
                    'frameworks',
                    'databases',
                    'testRunners',
                    'commands',
                    'ci',
                    'containers',
                    'migrations',
                    'monorepo',
                    'notes',
                ],
            },
            render: (_args, value) => [{ type: 'text', text: renderReport(value) }],
        },
        async execute(args, exec) {
            const input = args;
            if (input.path !== undefined && typeof input.path !== 'string')
                throw new Error('path 必须是字符串：仓库根目录的绝对路径');
            return probeStack(path.resolve(input.path ?? process.cwd()), exec.signal);
        },
    };
    ctx.tools.register(stackProbe);
    // 4) 随包分发的 Skill：注册进 ctx.skills（无 skills 服务的组合里自动跳过）
    const skillsDir = fileURLToPath(new URL('../skills', import.meta.url));
    const skills = loadSkills(skillsDir);
    ctx.inject(['skills'], (skillCtx) => {
        for (const skill of skills)
            skillCtx.skills.register(skill);
    });
    console.log('[fullstack-expert] plugin loaded');
}
