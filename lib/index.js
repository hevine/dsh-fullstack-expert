/**
 * dsh-fullstack-expert —— 全栈工程专家（DeepSeek Harness 组合包）
 *
 * 贡献：
 *   1. 常驻人设（systemPrompt.section，order 1，紧随部署人设）
 *   2. 工程流程引导（systemPrompt.section，order 450，先于 plan 策略）
 *   3. stack_probe 工具（技术栈探测，只读）
 *   4. repo_conventions 工具（仓库规约抽取，只读）
 *   5. run_checks 工具（执行项目声明的 lint/typecheck/test，只读检查）
 *   6. 四个工程 Skill（运行时注册进 ctx.skills，无需额外配置）
 *
 * 构建：npm run build（产物 lib/index.js，GitHub 安装直接可用）
 */
import { execFileSync, spawn } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync, } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const name = 'fullstack-expert';
export const inject = ['tools', 'systemPrompt'];
/** 遍历时跳过的目录：产物、依赖、工具链与 VCS 元数据 */
const SKIP_DIRS = new Set([
    'node_modules',
    '.git',
    '.hg',
    '.tools',
    'dist',
    'build',
    'out',
    'coverage',
    '.next',
    '.nuxt',
    '.output',
    '.turbo',
    '.cache',
    '.venv',
    'venv',
    '__pycache__',
    'vendor',
    'target',
]);
const CODE_EXTENSIONS = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mts',
    '.cts',
    '.go',
    '.py',
    '.rs',
    '.java',
    '.kt',
    '.php',
    '.rb',
    '.vue',
    '.svelte',
]);
const EXT_LABEL = {
    '.ts': 'TS',
    '.tsx': 'TSX',
    '.js': 'JS',
    '.jsx': 'JSX',
    '.mts': 'TS',
    '.cts': 'TS',
    '.go': 'Go',
    '.py': 'Python',
    '.rs': 'Rust',
    '.java': 'Java',
    '.kt': 'Kotlin',
    '.php': 'PHP',
    '.rb': 'Ruby',
    '.vue': 'Vue',
    '.svelte': 'Svelte',
};
/* ------------------------------ 基础读取 ------------------------------ */
function readJsonSync(file) {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    }
    catch {
        return null;
    }
}
function readTextSync(file) {
    try {
        return readFileSync(file, 'utf8');
    }
    catch {
        return '';
    }
}
/** 允许 tsconfig 这类带注释的 JSON */
function readJsoncSync(file) {
    const raw = readTextSync(file);
    if (!raw.trim())
        return null;
    const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    try {
        return JSON.parse(stripped);
    }
    catch {
        return null;
    }
}
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
function listDirSync(dir) {
    try {
        return readdirSync(dir);
    }
    catch {
        return [];
    }
}
/** 在 PATH 里找一个可执行文件，找不到返回 null */
function findExecutable(binary, searchPath = process.env.PATH ?? '') {
    if (binary.includes(path.sep)) {
        try {
            accessSync(binary, constants.X_OK);
            return binary;
        }
        catch {
            return null;
        }
    }
    for (const dir of searchPath.split(path.delimiter)) {
        if (!dir)
            continue;
        const candidate = path.join(dir, binary);
        try {
            accessSync(candidate, constants.X_OK);
            return candidate;
        }
        catch {
            // 换下一个 PATH 目录
        }
    }
    return null;
}
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
function parseMakefileTargets(file) {
    if (!existsSync(file))
        return [];
    const targets = new Set();
    for (const line of readTextSync(file).split(/\r?\n/)) {
        const matched = /^([A-Za-z0-9_.-]+)\s*:(?![=:])/.exec(line);
        if (!matched)
            continue;
        const target = matched[1];
        if (target.startsWith('.'))
            continue;
        targets.add(target);
    }
    return [...targets];
}
function nodeManager(dir, pkg, fallback) {
    const own = detectPackageManager(dir, pkg);
    if (own !== 'unknown')
        return own;
    return fallback !== 'unknown' ? fallback : 'npm';
}
/**
 * 找出仓库里的可独立构建单元：根目录 + 两层内的 package.json / go.mod /
 * pyproject.toml / Cargo.toml。根目录没有 package.json 的多栈仓库靠这层识别。
 */
function discoverProjects(root) {
    const rootPkg = readJsonSync(path.join(root, 'package.json'));
    const rootManager = detectPackageManager(root, rootPkg);
    const projects = [];
    const visit = (dir, depth) => {
        const abs = dir === '.' ? root : path.join(root, dir);
        const pkg = readJsonSync(path.join(abs, 'package.json'));
        if (pkg) {
            projects.push({ dir, abs, kind: 'node', manager: nodeManager(abs, pkg, rootManager) });
        }
        else if (existsSync(path.join(abs, 'go.mod'))) {
            projects.push({ dir, abs, kind: 'go', manager: 'go' });
        }
        else if (existsSync(path.join(abs, 'pyproject.toml')) ||
            existsSync(path.join(abs, 'requirements.txt'))) {
            projects.push({ dir, abs, kind: 'python', manager: 'python' });
        }
        else if (existsSync(path.join(abs, 'Cargo.toml'))) {
            projects.push({ dir, abs, kind: 'rust', manager: 'cargo' });
        }
        if (depth >= 2)
            return;
        let entries = [];
        try {
            entries = readdirSync(abs, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name))
                continue;
            visit(dir === '.' ? entry.name : `${dir}/${entry.name}`, depth + 1);
        }
    };
    visit('.', 0);
    return projects;
}
function projectSummaries(projects) {
    return projects.map((project) => {
        const pkg = readJsonSync(path.join(project.abs, 'package.json'));
        const scripts = pkg?.scripts ?? {};
        const commands = project.kind === 'node'
            ? Object.entries(pickCommands(scripts, project.manager)).map(([key, command]) => `${key}=${command}`)
            : project.kind === 'go'
                ? ['lint=go vet ./...', 'test=go test ./...']
                : [];
        return {
            dir: project.dir,
            kind: project.kind,
            manager: project.manager,
            commands,
        };
    });
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
    const projects = discoverProjects(root);
    for (const project of projects) {
        if (project.dir === '.')
            continue;
        if (project.kind === 'node' && !languages.includes('TypeScript/JavaScript'))
            languages.push(`TypeScript/JavaScript（${project.dir}）`);
        if (project.kind === 'go' && !languages.includes('Go'))
            languages.push(`Go（${project.dir}）`);
    }
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
    const hasGoMod = existsSync(path.join(root, 'go.mod'));
    const detectedPm = detectPackageManager(root, pkg);
    const pm = detectedPm === 'unknown' && hasGoMod && !pkg ? 'go modules' : detectedPm;
    const scripts = pkg?.scripts ?? {};
    const commands = pickCommands(scripts, pm);
    const makeTargets = parseMakefileTargets(path.join(root, 'Makefile'));
    for (const check of ['lint', 'typecheck', 'test', 'build']) {
        if (makeTargets.includes(check) && !commands[check])
            commands[check] = `make ${check}`;
    }
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
    const monorepo = projects.length > 1 ||
        pkg?.workspaces !== undefined ||
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
        ...(hasGoMod &&
            collectCodeFiles(root).some((file) => file.ext === '.go' && /_test\.go$/.test(file.rel))
            ? ['go test']
            : []),
    ];
    if (!commands.test && testRunners.length > 0 && !makeTargets.includes('test'))
        notes.push(`检测到 ${testRunners.join('/')}，但 package.json scripts 里没有 test 命令，需手动确认调用方式`);
    if (pkg && typeof scripts.lint !== 'string' && !makeTargets.includes('lint'))
        notes.push('没有声明 lint 脚本，改动前请确认项目实际的静态检查入口');
    if (pm === 'unknown' && pkg)
        notes.push('未识别包管理器，执行命令前先看 lockfile 或 README');
    if (projects.length > 1)
        notes.push(`识别到 ${projects.length} 个子项目（${projects.map((p) => `${p.dir}=${p.kind}`).join('、')}），执行检查时按项目分别处理`);
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
        projects: projectSummaries(projects),
        makeTargets,
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
    if (report.makeTargets.length > 0)
        lines.push(`Makefile 目标：${report.makeTargets.join('、')}`);
    if (report.projects.length > 1) {
        lines.push('子项目：');
        for (const project of report.projects) {
            const cmds = project.commands.length > 0 ? project.commands.join('；') : '无可执行命令';
            lines.push(`- ${project.dir}：${project.kind}/${project.manager}，${cmds}`);
        }
    }
    if (report.notes.length > 0)
        lines.push(`注意：${report.notes.join('；')}`);
    return lines.join('\n');
}
const CHECK_KINDS = ['lint', 'typecheck', 'test', 'build'];
const NODE_SCRIPT_KEYS = {
    lint: ['lint', 'lint:check', 'eslint'],
    typecheck: ['typecheck', 'type-check', 'tsc'],
    test: ['test', 'test:unit', 'tests'],
    build: ['build', 'compile'],
};
const GO_COMMANDS = {
    lint: { args: ['vet', './...'], label: 'go vet ./...' },
    // go vet 已包含类型检查，Go 没有独立的 typecheck 入口
    typecheck: null,
    test: { args: ['test', './...'], label: 'go test ./...' },
    build: { args: ['build', './...'], label: 'go build ./...' },
};
function buildCheckPlans(root, projects, makeTargets, checks) {
    const plans = [];
    const missing = [];
    // build 优先走 Makefile 的 build 目标：多栈仓库的完整构建入口通常在这里，
    // 且它已经包含子项目构建，避免同一轮里重复跑一遍前端。
    const rootProject = projects.find((project) => project.dir === '.');
    const makeBuild = checks.includes('build') && makeTargets.includes('build') && rootProject !== undefined;
    for (const check of checks) {
        if (check === 'build' && makeBuild && rootProject) {
            plans.push({
                project: '.',
                projectKind: rootProject.kind,
                check,
                bin: 'make',
                args: ['build'],
                command: 'make build',
                source: 'Makefile#build',
                cwd: root,
            });
            continue;
        }
        for (const project of projects) {
            if (project.kind === 'node') {
                const pkg = readJsonSync(path.join(project.abs, 'package.json'));
                const scripts = pkg?.scripts ?? {};
                const key = NODE_SCRIPT_KEYS[check].find((name) => typeof scripts[name] === 'string');
                if (key) {
                    plans.push({
                        project: project.dir,
                        projectKind: project.kind,
                        check,
                        bin: project.manager,
                        args: ['run', key],
                        command: `${project.manager} run ${key}`,
                        source: `${project.dir === '.' ? '' : `${project.dir}/`}package.json#${key}`,
                        cwd: project.abs,
                    });
                    continue;
                }
                // typecheck 兜底：有 tsconfig 且装了本地 tsc 时，用 --noEmit（不产出文件）
                const localTsc = path.join(project.abs, 'node_modules', '.bin', 'tsc');
                if (check === 'typecheck' &&
                    existsSync(path.join(project.abs, 'tsconfig.json')) &&
                    existsSync(localTsc)) {
                    plans.push({
                        project: project.dir,
                        projectKind: project.kind,
                        check,
                        bin: localTsc,
                        args: ['--noEmit'],
                        command: 'tsc --noEmit（本地）',
                        source: `${project.dir === '.' ? '' : `${project.dir}/`}tsconfig.json`,
                        cwd: project.abs,
                    });
                    continue;
                }
                missing.push(`${project.dir}：package.json 未声明 ${check} 脚本`);
                continue;
            }
            if (project.kind === 'go') {
                const spec = GO_COMMANDS[check];
                if (!spec) {
                    missing.push(`${project.dir}：Go 没有独立 ${check} 入口（go vet 已覆盖类型检查）`);
                    continue;
                }
                plans.push({
                    project: project.dir,
                    projectKind: project.kind,
                    check,
                    bin: 'go',
                    args: spec.args,
                    command: spec.label,
                    source: 'go.mod',
                    cwd: project.abs,
                });
                continue;
            }
            missing.push(`${project.dir}：${project.kind} 项目暂无可执行 ${check} 命令`);
        }
    }
    return { plans, missing };
}
/** 解析仓库内（或上一级 workspace）自带的 Go 工具链，避免依赖全局 go */
function resolveGoToolchain(root) {
    const candidates = [
        path.join(root, '.tools', 'go', 'bin', 'go'),
        path.join(path.dirname(root), '.tools', 'go', 'bin', 'go'),
    ];
    for (const bin of candidates) {
        if (!existsSync(bin))
            continue;
        const goroot = path.dirname(path.dirname(bin));
        const toolsDir = path.dirname(goroot);
        return {
            bin,
            env: {
                GOROOT: goroot,
                GOPATH: path.join(toolsDir, 'gopath'),
                GOCACHE: path.join(toolsDir, 'gocache'),
                GOTOOLCHAIN: 'local',
                PATH: `${path.join(goroot, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
            },
        };
    }
    return { bin: 'go', env: {} };
}
function stripAnsi(text) {
    return text.replace(/\u001b\[[0-9;]*m/g, '');
}
function runProcess(options) {
    return new Promise((resolve) => {
        const started = Date.now();
        let settled = false;
        let tail = '';
        let timer;
        let timedOut = false;
        let aborted = false;
        const child = spawn(options.bin, options.args, {
            cwd: options.cwd,
            env: options.env,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const append = (chunk) => {
            tail = (tail + chunk.toString('utf8')).slice(-12000);
        };
        const finish = (status, exitCode, detail) => {
            if (settled)
                return;
            settled = true;
            if (timer)
                clearTimeout(timer);
            options.signal?.removeEventListener('abort', onAbort);
            resolve({
                status,
                exitCode,
                durationMs: Date.now() - started,
                output: stripAnsi(tail).trim(),
                detail,
            });
        };
        const kill = () => {
            child.kill('SIGTERM');
            const hard = setTimeout(() => child.kill('SIGKILL'), 2000);
            hard.unref();
        };
        const onAbort = () => {
            aborted = true;
            kill();
        };
        if (options.signal?.aborted)
            onAbort();
        else
            options.signal?.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => {
            timedOut = true;
            kill();
        }, options.timeoutMs);
        child.stdout?.on('data', append);
        child.stderr?.on('data', append);
        child.on('error', (error) => {
            finish('unavailable', null, error.code === 'ENOENT'
                ? `找不到可执行文件 ${options.bin}`
                : `启动失败：${error.message}`);
        });
        child.on('close', (code) => {
            if (aborted)
                return finish('aborted', code, '执行被取消');
            if (timedOut)
                return finish('timeout', code, `超过 ${Math.round(options.timeoutMs / 1000)} 秒未结束`);
            finish(code === 0 ? 'passed' : 'failed', code, '');
        });
    });
}
function goToolchainHint(root) {
    const hints = [];
    if (existsSync(path.join(root, 'scripts', 'bootstrap.sh')))
        hints.push('先运行 sh scripts/bootstrap.sh 安装本地工具链');
    if (existsSync(path.join(root, 'scripts', 'goenv.sh')))
        hints.push('或 source scripts/goenv.sh 注入 GOROOT');
    return hints.length > 0 ? `（${hints.join('；')}）` : '';
}
function parseChecks(value) {
    if (value === undefined)
        return ['lint', 'typecheck', 'test'];
    if (!Array.isArray(value) || value.length === 0)
        throw new Error('checks 必须是非空数组');
    const checks = [];
    for (const item of value) {
        if (typeof item !== 'string' || !CHECK_KINDS.includes(item))
            throw new Error(`checks 只接受 ${CHECK_KINDS.join('/')}，收到 ${String(item)}`);
        checks.push(item);
    }
    return [...new Set(checks)];
}
function parseTimeout(value, fallback) {
    if (value === undefined)
        return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value))
        throw new Error('timeoutMs 必须是数字');
    return Math.min(Math.max(Math.round(value), 5000), 600000);
}
function parseProjects(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
        throw new Error('projects 必须是子项目目录字符串数组，例如 ["web"]');
    return value;
}
async function runChecks(root, input, signal) {
    const checks = parseChecks(input.checks);
    // build 往往包含依赖安装与整包编译，给更宽的超时预算
    const timeoutMs = parseTimeout(input.timeoutMs, checks.includes('build') ? 300000 : 180000);
    const stopOnFailure = input.stopOnFailure !== false;
    const dryRun = input.dryRun === true;
    const wanted = parseProjects(input.projects);
    const projects = discoverProjects(root);
    if (projects.length === 0)
        throw new Error(`在 ${root} 未发现 package.json / go.mod / pyproject.toml / Cargo.toml`);
    const selected = wanted.length > 0 ? projects.filter((p) => wanted.includes(p.dir)) : projects;
    const notes = [];
    for (const dir of wanted) {
        if (!projects.some((p) => p.dir === dir))
            notes.push(`未找到子项目 ${dir}，已忽略`);
    }
    const makeTargets = parseMakefileTargets(path.join(root, 'Makefile'));
    if (makeTargets.includes('test'))
        notes.push('Makefile 有 test 目标；run_checks 直接执行语言原生入口（go vet / go test），不调用 make，避免触发构建或安装');
    if (checks.includes('build') &&
        makeTargets.includes('build') &&
        selected.some((project) => project.dir === '.'))
        notes.push('build 由 Makefile 统一驱动（含子项目），未重复执行子项目 build');
    const { plans, missing } = buildCheckPlans(root, selected, makeTargets, checks);
    const go = resolveGoToolchain(root);
    const hasLocalGo = path.isAbsolute(go.bin);
    const goAvailable = hasLocalGo || findExecutable('go') !== null;
    const results = [];
    let stopped = false;
    for (const plan of plans) {
        if (stopped) {
            results.push({
                project: plan.project,
                check: plan.check,
                command: plan.command,
                source: plan.source,
                status: 'skipped',
                exitCode: null,
                durationMs: 0,
                outputTail: '',
                detail: '前一项检查失败，已跳过（可用 stopOnFailure:false 跑完整轮）',
            });
            continue;
        }
        if (dryRun) {
            results.push({
                project: plan.project,
                check: plan.check,
                command: plan.command,
                source: plan.source,
                status: 'skipped',
                exitCode: null,
                durationMs: 0,
                outputTail: '',
                detail: `dryRun：未执行，来源 ${plan.source}`,
            });
            continue;
        }
        const needsGo = plan.projectKind === 'go';
        const executable = plan.bin === 'go' ? (hasLocalGo ? go.bin : findExecutable('go')) : findExecutable(plan.bin);
        if (needsGo && !goAvailable) {
            results.push({
                project: plan.project,
                check: plan.check,
                command: plan.command,
                source: plan.source,
                status: 'unavailable',
                exitCode: null,
                durationMs: 0,
                outputTail: '',
                detail: `本机找不到 go 可执行文件${goToolchainHint(root)}`,
            });
            if (stopOnFailure)
                stopped = true;
            continue;
        }
        if (!executable) {
            results.push({
                project: plan.project,
                check: plan.check,
                command: plan.command,
                source: plan.source,
                status: 'unavailable',
                exitCode: null,
                durationMs: 0,
                outputTail: '',
                detail: `本机找不到 ${plan.bin}，请先安装或改用项目自带工具链`,
            });
            if (stopOnFailure)
                stopped = true;
            continue;
        }
        // make 构建自己会处理依赖，不能按「node 项目缺 node_modules」直接跳过
        const usesNodeManager = plan.bin !== 'make' && plan.bin !== 'go';
        if (plan.projectKind === 'node' &&
            usesNodeManager &&
            !existsSync(path.join(plan.cwd, 'node_modules'))) {
            results.push({
                project: plan.project,
                check: plan.check,
                command: plan.command,
                source: plan.source,
                status: 'skipped',
                exitCode: null,
                durationMs: 0,
                outputTail: '',
                detail: `依赖未安装：先在 ${plan.cwd} 执行 ${plan.bin} install`,
            });
            continue;
        }
        const env = plan.projectKind === 'go' ? { ...process.env, ...go.env } : { ...process.env };
        const outcome = await runProcess({
            bin: executable,
            args: plan.args,
            cwd: plan.cwd,
            env,
            timeoutMs,
            signal,
        });
        results.push({
            project: plan.project,
            check: plan.check,
            command: plan.command,
            source: plan.source,
            status: outcome.status,
            exitCode: outcome.exitCode,
            durationMs: Math.round(outcome.durationMs),
            outputTail: outcome.output,
            detail: outcome.detail,
        });
        if (outcome.status === 'aborted')
            break;
        if (outcome.status !== 'passed' && stopOnFailure)
            stopped = true;
    }
    if (checks.includes('typecheck') && selected.some((p) => p.kind === 'node')) {
        notes.push('Node 项目若没有 typecheck 脚本，可检查 tsconfig 与本地 tsc 是否存在');
    }
    const staleArtifacts = findArtifactPairs(root, projects).filter((item) => item.status !== 'fresh');
    if (staleArtifacts.length > 0) {
        notes.push(`前端产物与源码不一致：${staleArtifacts
            .map((item) => `${item.output}（${item.status === 'missing' ? '缺产物' : '落后于源码'}）`)
            .join('、')}；先重建前端再打包二进制`);
    }
    return { root, results, notes: [...notes, ...missing] };
}
function renderChecks(report) {
    const icon = {
        passed: '✓',
        failed: '✗',
        skipped: '-',
        unavailable: '!',
        timeout: 'T',
        aborted: 'X',
    };
    const lines = [`仓库：${report.root}`];
    for (const result of report.results) {
        const duration = result.durationMs >= 1000
            ? `${(result.durationMs / 1000).toFixed(1)}s`
            : `${result.durationMs}ms`;
        const exit = result.exitCode === null ? '' : `，exit ${result.exitCode}`;
        lines.push(`[${icon[result.status]} ${result.status}] ${result.project} ${result.check} — ${result.command}（${duration}${exit}）`);
        if (result.detail)
            lines.push(`    ${result.detail}`);
        if ((result.status === 'failed' || result.status === 'timeout') && result.outputTail) {
            const tail = result.outputTail.split('\n').slice(-20);
            lines.push(...tail.map((line) => `    ${line}`));
        }
    }
    const count = (status) => report.results.filter((r) => r.status === status).length;
    const total = report.results.reduce((sum, result) => sum + result.durationMs, 0);
    lines.push(`摘要：${count('passed')} 通过 / ${count('failed')} 失败 / ${count('skipped')} 跳过 / ${count('unavailable')} 不可用（总计 ${(total / 1000).toFixed(1)}s）`);
    if (report.notes.length > 0)
        lines.push(`说明：${report.notes.join('；')}`);
    return lines.join('\n');
}
function collectCodeFiles(root, limit = 800) {
    const files = [];
    const walk = (dir, depth) => {
        if (files.length >= limit)
            return;
        let entries = [];
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (files.length >= limit)
                return;
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (depth >= 4)
                    continue;
                if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name))
                    continue;
                walk(abs, depth + 1);
                continue;
            }
            if (!entry.isFile())
                continue;
            const ext = path.extname(entry.name).toLowerCase();
            if (!CODE_EXTENSIONS.has(ext))
                continue;
            files.push({ rel: path.relative(root, abs), ext });
        }
    };
    walk(root, 0);
    return files;
}
function isTestPath(rel) {
    const base = path.basename(rel);
    return (/\.(test|spec)\.[^.]+$/.test(base) ||
        /_test\.[^.]+$/.test(base) ||
        rel.split(path.sep).includes('__tests__') ||
        /(^|\/)(tests?|spec)\//.test(rel));
}
function baseName(rel) {
    const name = path.basename(rel);
    const ext = path.extname(name);
    return name
        .slice(0, ext.length > 0 ? -ext.length : undefined)
        .replace(/\.(test|spec|d)$/, '')
        .replace(/_test$/, '');
}
function namingStyle(base) {
    if (!base || base.includes('.'))
        return null;
    if (/^(index|main|mod|setup|app)$/i.test(base))
        return null;
    if (base.includes('-'))
        return 'kebab-case';
    if (base.includes('_'))
        return 'snake_case';
    if (/^[A-Z]/.test(base))
        return 'PascalCase';
    if (base === base.toLowerCase())
        return 'lowercase';
    return 'camelCase';
}
function summarizeNaming(files) {
    const buckets = new Map();
    for (const file of files) {
        if (isTestPath(file.rel))
            continue;
        const style = namingStyle(baseName(file.rel));
        if (!style)
            continue;
        const label = EXT_LABEL[file.ext] ?? file.ext;
        let byStyle = buckets.get(label);
        if (!byStyle) {
            byStyle = new Map();
            buckets.set(label, byStyle);
        }
        const examples = byStyle.get(style) ?? [];
        examples.push(file.rel);
        byStyle.set(style, examples);
    }
    const summaries = [];
    for (const [ext, byStyle] of buckets) {
        for (const [style, examples] of byStyle) {
            summaries.push({ ext, style, count: examples.length, examples: examples.slice(0, 3) });
        }
    }
    return summaries.sort((a, b) => b.count - a.count).slice(0, 8);
}
function summarizeTests(files) {
    const buckets = new Map();
    for (const file of files) {
        const base = path.basename(file.rel);
        let pattern = '';
        if (/\.(test|spec)\.[^.]+$/.test(base))
            pattern = '*.test.* / *.spec.*（与实现同目录）';
        else if (/_test\.[^.]+$/.test(base))
            pattern = '*_test.go';
        else if (file.rel.split(path.sep).includes('__tests__'))
            pattern = '__tests__/';
        else if (/(^|\/)(tests?|spec)\//.test(file.rel))
            pattern = 'tests/ 或 spec/ 目录';
        if (!pattern)
            continue;
        const examples = buckets.get(pattern) ?? [];
        examples.push(file.rel);
        buckets.set(pattern, examples);
    }
    return [...buckets.entries()]
        .map(([pattern, examples]) => ({
        pattern,
        count: examples.length,
        examples: examples.slice(0, 3),
    }))
        .sort((a, b) => b.count - a.count);
}
function readEnvKeys(file) {
    if (!existsSync(file))
        return [];
    const keys = [];
    for (const line of readTextSync(file).split(/\r?\n/)) {
        const matched = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
        if (matched)
            keys.push(matched[1]);
    }
    return keys;
}
const CONFIG_FILES = [
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    'eslint.config.ts',
    '.eslintrc',
    '.eslintrc.json',
    '.eslintrc.cjs',
    '.eslintrc.js',
    '.prettierrc',
    '.prettierrc.json',
    '.prettierrc.js',
    'prettier.config.js',
    'prettier.config.cjs',
    '.editorconfig',
    '.nvmrc',
    '.golangci.yml',
    '.golangci.yaml',
    'ruff.toml',
    '.ruff.toml',
    'mypy.ini',
    '.flake8',
];
function detectConfigs(root, makeTargets, projects) {
    const out = [];
    const add = (file) => {
        if (existsSync(path.join(root, file)))
            out.push(file);
    };
    // 配置可能落在子项目里（如 web/tsconfig.json），按项目目录分别检查
    const dirs = [{ abs: root, prefix: '' }];
    for (const project of projects) {
        if (project.dir === '.')
            continue;
        dirs.push({ abs: project.abs, prefix: `${project.dir}/` });
    }
    for (const { abs, prefix } of dirs) {
        const tsconfig = readJsoncSync(path.join(abs, 'tsconfig.json'));
        if (tsconfig) {
            const options = tsconfig.compilerOptions;
            const strict = options?.strict === true;
            const alias = options?.paths !== undefined;
            out.push(`${prefix}tsconfig.json（strict=${strict}${alias ? '，paths 别名' : ''}）`);
        }
        for (const file of CONFIG_FILES) {
            if (existsSync(path.join(abs, file)))
                out.push(prefix + file);
        }
    }
    const goMod = readTextSync(path.join(root, 'go.mod'));
    if (goMod) {
        const version = /^go\s+([0-9.]+)/m.exec(goMod)?.[1];
        out.push(`go.mod（go ${version ?? '版本未知'}）`);
    }
    if (makeTargets.length > 0)
        out.push(`Makefile（${makeTargets.join('/')}）`);
    const workflows = listDirSync(path.join(root, '.github', 'workflows'));
    if (workflows.length > 0)
        out.push(`.github/workflows（${workflows.length} 个）`);
    for (const file of ['.gitlab-ci.yml', 'Dockerfile', 'docker-compose.yml', 'compose.yaml'])
        add(file);
    const envKeys = readEnvKeys(path.join(root, '.env.example'));
    if (envKeys.length > 0)
        out.push(`.env.example（${envKeys.length} 个变量）`);
    return out;
}
function tryGit(root, args) {
    try {
        return execFileSync('git', args, {
            cwd: root,
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    }
    catch {
        return '';
    }
}
function summarizeGit(root) {
    const branch = tryGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    const recent = tryGit(root, ['log', '-12', '--pretty=%s'])
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const conventional = recent.filter((subject) => /^(feat|fix|chore|docs|refactor|test|perf|build|ci|style|revert)(\([^)]*\))?!?:/.test(subject)).length;
    return { branch, conventional, total: recent.length, recent: recent.slice(0, 8) };
}
function pickSamples(files, limit = 6) {
    const buckets = new Map();
    for (const file of files) {
        if (isTestPath(file.rel))
            continue;
        if (/\.(config|d)\.[^.]+$/.test(path.basename(file.rel)))
            continue;
        const parts = file.rel.split(path.sep);
        const key = parts.length >= 3 ? `${parts[0]}/${parts[1]}` : parts.length === 2 ? parts[0] : '(根目录)';
        const group = buckets.get(key) ?? [];
        group.push(file.rel);
        buckets.set(key, group);
    }
    // 先保证每个顶层目录各出一个样本，再按目录名补齐，避免样本全集中在 internal/
    const byTop = new Map();
    for (const [key, group] of buckets) {
        const top = key === '(根目录)' ? key : key.split('/')[0];
        const list = byTop.get(top) ?? [];
        list.push({ key, file: group.sort()[0] });
        byTop.set(top, list);
    }
    const picked = [];
    for (const top of [...byTop.keys()].sort()) {
        const first = byTop.get(top).sort((a, b) => a.key.localeCompare(b.key))[0];
        if (picked.includes(first.file))
            continue;
        picked.push(first.file);
        if (picked.length >= limit)
            return picked;
    }
    for (const [, group] of [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const file = group.sort()[0];
        if (picked.includes(file))
            continue;
        picked.push(file);
        if (picked.length >= limit)
            break;
    }
    return picked;
}
/** vite 的 outDir（相对项目目录），未配置时用 Vite 默认值 dist */
function readViteOutDir(projectAbs) {
    for (const name of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.mts']) {
        const file = path.join(projectAbs, name);
        if (!existsSync(file))
            continue;
        const matched = /outDir\s*:\s*['"`]([^'"`]+)['"`]/.exec(readTextSync(file));
        return matched ? matched[1] : 'dist';
    }
    return null;
}
function newestMtimeMs(dirAbs, depth = 6) {
    let newest = 0;
    const walk = (dir, level) => {
        let entries = [];
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (level >= depth || entry.name.startsWith('.') || SKIP_DIRS.has(entry.name))
                    continue;
                walk(abs, level + 1);
                continue;
            }
            if (!entry.isFile())
                continue;
            try {
                newest = Math.max(newest, statSync(abs).mtimeMs);
            }
            catch {
                // 忽略瞬时删除或权限问题
            }
        }
    };
    walk(dirAbs, 0);
    return newest;
}
/** 用 vite 的 outDir 反查 go:embed 目录对应的前端项目 */
function frontendSourceFor(root, projects, outputAbs) {
    for (const project of projects) {
        if (project.kind !== 'node')
            continue;
        const outDir = readViteOutDir(project.abs);
        if (!outDir)
            continue;
        if (path.resolve(project.abs, outDir) !== outputAbs)
            continue;
        const srcAbs = path.join(project.abs, 'src');
        const abs = existsSync(srcAbs) ? srcAbs : project.abs;
        return { rel: path.relative(root, abs), abs };
    }
    return null;
}
function formatLocal(ms) {
    if (ms <= 0)
        return '';
    return new Date(ms).toLocaleString('sv-SE', { hour12: false });
}
function findArtifactPairs(root, projects) {
    const pairs = [];
    const seen = new Set();
    for (const file of collectCodeFiles(root)) {
        if (file.ext !== '.go')
            continue;
        const text = readTextSync(path.join(root, file.rel));
        if (!text.includes('//go:embed'))
            continue;
        for (const matched of text.matchAll(/\/\/go:embed\s+([^\n]+)/g)) {
            const token = matched[1].trim().split(/\s+/)[0].replace(/^all:/, '');
            if (!token || token.includes('*') || token.includes('{'))
                continue;
            const outputAbs = path.resolve(path.dirname(path.join(root, file.rel)), token);
            const outputRel = path.relative(root, outputAbs);
            if (seen.has(outputRel))
                continue;
            const source = frontendSourceFor(root, projects, outputAbs);
            if (!source)
                continue;
            seen.add(outputRel);
            const sourceMs = newestMtimeMs(source.abs);
            const indexAbs = path.join(outputAbs, 'index.html');
            const outputMs = existsSync(indexAbs) ? statSync(indexAbs).mtimeMs : newestMtimeMs(outputAbs);
            const status = outputMs === 0 ? 'missing' : sourceMs > outputMs + 1000 ? 'stale' : 'fresh';
            pairs.push({
                source: source.rel,
                output: outputRel,
                sourceUpdatedAt: formatLocal(sourceMs),
                outputBuiltAt: formatLocal(outputMs),
                status,
            });
        }
    }
    return pairs;
}
function collectConventions(root) {
    const projects = discoverProjects(root);
    const makeTargets = parseMakefileTargets(path.join(root, 'Makefile'));
    const files = collectCodeFiles(root);
    const layoutCounts = new Map();
    for (const file of files) {
        const parts = file.rel.split(path.sep);
        const key = parts.length > 1 ? parts[0] : '(根目录)';
        layoutCounts.set(key, (layoutCounts.get(key) ?? 0) + 1);
    }
    const layout = [...layoutCounts.entries()]
        .map(([dir, count]) => ({ dir: dir === '(根目录)' ? dir : `${dir}/`, files: count }))
        .sort((a, b) => b.files - a.files)
        .slice(0, 10);
    const tests = summarizeTests(files);
    const notes = [];
    if (files.length === 0)
        notes.push('未发现源码文件，确认 path 是否指向仓库根');
    if (tests.length === 0)
        notes.push('未发现测试文件，改动前先确认项目靠什么验证');
    const configs = detectConfigs(root, makeTargets, projects);
    if (files.length > 0 &&
        !configs.some((config) => config.includes('eslint') || config.includes('golangci')))
        notes.push('未发现 lint 配置，静态检查入口需从 Makefile / CI 里确认');
    for (const project of projects) {
        if (project.kind !== 'node')
            continue;
        if (!existsSync(path.join(project.abs, 'node_modules')))
            notes.push(`${project.dir} 依赖未安装（${project.manager} install）`);
    }
    const artifacts = findArtifactPairs(root, projects);
    for (const item of artifacts) {
        if (item.status === 'stale')
            notes.push(`${item.source} 比 ${item.output} 新，需重建前端，否则二进制里仍是旧 UI`);
        if (item.status === 'missing')
            notes.push(`${item.output} 不存在，前端尚未构建`);
    }
    return {
        root,
        projects: projectSummaries(projects),
        artifacts,
        layout,
        naming: summarizeNaming(files),
        tests,
        configs,
        envKeys: readEnvKeys(path.join(root, '.env.example')).slice(0, 30),
        git: summarizeGit(root),
        readNext: pickSamples(files),
        notes,
    };
}
function renderConventions(report) {
    const lines = [`仓库：${report.root}`];
    if (report.projects.length > 0) {
        const projects = report.projects
            .map((project) => `${project.dir}（${project.kind}/${project.manager}）`)
            .join('、');
        lines.push(`项目：${projects}`);
    }
    if (report.layout.length > 0)
        lines.push(`目录：${report.layout.map((item) => `${item.dir} ${item.files}`).join(' · ')}`);
    if (report.naming.length > 0) {
        lines.push('命名：');
        for (const item of report.naming) {
            lines.push(`- ${item.ext} ${item.style} ${item.count} 个，例：${item.examples.join('、')}`);
        }
    }
    if (report.tests.length > 0) {
        lines.push('测试：');
        for (const item of report.tests) {
            lines.push(`- ${item.pattern} ${item.count} 个，例：${item.examples.join('、')}`);
        }
    }
    else {
        lines.push('测试：未发现测试文件');
    }
    if (report.configs.length > 0)
        lines.push(`配置：${report.configs.join('、')}`);
    if (report.envKeys.length > 0)
        lines.push(`环境变量（仅名称）：${report.envKeys.join('、')}`);
    if (report.artifacts.length > 0) {
        lines.push('产物新鲜度：');
        for (const item of report.artifacts) {
            const detail = item.status === 'fresh'
                ? `产物 ${item.outputBuiltAt}`
                : item.status === 'missing'
                    ? '产物缺失'
                    : `源码 ${item.sourceUpdatedAt} 晚于产物 ${item.outputBuiltAt}`;
            lines.push(`- ${item.source} → ${item.output}：${item.status}（${detail}）`);
        }
    }
    if (report.git.branch) {
        const ratio = report.git.total > 0 ? `${report.git.conventional}/${report.git.total}` : '0/0';
        lines.push(`Git：分支 ${report.git.branch}，Conventional Commits ${ratio}`);
        if (report.git.recent.length > 0)
            lines.push(`最近提交：${report.git.recent.join(' / ')}`);
    }
    if (report.readNext.length > 0)
        lines.push(`建议先读（用于抽取真实写法）：${report.readNext.join('、')}`);
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
            '- 完成标准是「可验证」：用 run_checks 跑出真实的 lint / typecheck / test 结果；涉及单二进制或前端内嵌产物时加 build，并确认产物已更新。失败就如实说明。',
            '回答用简洁的工程语言，结论先行，代码引用标注文件路径。',
        ].join('\n'),
    });
    // 2) 流程引导：先于 plan 策略，plan mode 打开时其规则仍可覆盖本段
    ctx.systemPrompt.section({
        name: 'fullstack-expert:workflow',
        order: 450,
        text: [
            '实现类任务的第一步：调用 stack_probe（可传仓库根的绝对路径）取得语言、包管理器、子项目、',
            '框架、数据库、测试框架、lint/test 命令、CI 与容器配置。后续命令必须来自探测结果或仓库既有脚本。',
            '首次接触仓库或改动跨模块时，调用 repo_conventions 拿到目录结构、命名风格、测试位置、配置清单',
            '与「建议先读」文件；再按其中的 readNext 真读 2-3 个文件，确认该仓库的实际写法后动手。',
            '改完必须调用 run_checks 跑 lint/typecheck/test；涉及前端内嵌产物或单二进制时再加 build，并确认产物已更新。把真实输出写进回答；',
            '失败就贴输出尾部并继续修，直到通过，或明确说明某个检查为何无法运行。',
            '不要自创检查命令，也不要用「应该能通过」替代实际运行。',
            '按改动领域加载对应 skill 获取该层的动手前检查与完成标准：',
            'frontend（页面、组件、样式、构建）、backend（接口、服务、鉴权、事务）、',
            'database（模型、迁移、索引、回填）、deploy（容器、CI、环境变量、发布与回滚）。',
            '跨层改动按「契约 → 实现 → 迁移 → 部署」顺序推进。',
        ].join('\n'),
    });
    // 3) 只读探测工具。直接注册原始 ToolDefinition：不依赖任何 dsh 运行时包，
    //    因此从任意路径 --patch 加载都能工作（参数校验自行负责）。
    const stackProbe = {
        name: 'stack_probe',
        description: '探测仓库技术栈：语言、包管理器、子项目、前端/后端框架、数据库与迁移目录、测试框架、lint/test 命令、Makefile 目标、CI 与容器配置。只读，不改动文件。',
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
                    projects: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                dir: { type: 'string' },
                                kind: { type: 'string' },
                                manager: { type: 'string' },
                                commands: { type: 'array', items: { type: 'string' } },
                            },
                            required: ['dir', 'kind', 'manager', 'commands'],
                        },
                    },
                    makeTargets: { type: 'array', items: { type: 'string' } },
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
                    'projects',
                    'makeTargets',
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
    // 4) 仓库规约抽取：只读采样，输出事实与「建议先读」清单
    const conventionsTool = {
        name: 'repo_conventions',
        description: '抽取仓库的实际工程规约：子项目与命令、目录结构与文件量、源码命名风格、测试文件位置、配置清单（tsconfig/eslint/golangci/Makefile 等）、.env 变量名、Git 提交风格、前端产物是否落后于源码，以及建议先读的代表文件。只读，不写文件。',
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
                    projects: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                dir: { type: 'string' },
                                kind: { type: 'string' },
                                manager: { type: 'string' },
                                commands: { type: 'array', items: { type: 'string' } },
                            },
                            required: ['dir', 'kind', 'manager', 'commands'],
                        },
                    },
                    layout: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                dir: { type: 'string' },
                                files: { type: 'integer' },
                            },
                            required: ['dir', 'files'],
                        },
                    },
                    naming: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                ext: { type: 'string' },
                                style: { type: 'string' },
                                count: { type: 'integer' },
                                examples: { type: 'array', items: { type: 'string' } },
                            },
                            required: ['ext', 'style', 'count', 'examples'],
                        },
                    },
                    tests: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                pattern: { type: 'string' },
                                count: { type: 'integer' },
                                examples: { type: 'array', items: { type: 'string' } },
                            },
                            required: ['pattern', 'count', 'examples'],
                        },
                    },
                    configs: { type: 'array', items: { type: 'string' } },
                    envKeys: { type: 'array', items: { type: 'string' } },
                    artifacts: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                source: { type: 'string' },
                                output: { type: 'string' },
                                sourceUpdatedAt: { type: 'string' },
                                outputBuiltAt: { type: 'string' },
                                status: { type: 'string', enum: ['fresh', 'stale', 'missing'] },
                            },
                            required: ['source', 'output', 'sourceUpdatedAt', 'outputBuiltAt', 'status'],
                        },
                    },
                    git: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            branch: { type: 'string' },
                            conventional: { type: 'integer' },
                            total: { type: 'integer' },
                            recent: { type: 'array', items: { type: 'string' } },
                        },
                        required: ['branch', 'conventional', 'total', 'recent'],
                    },
                    readNext: { type: 'array', items: { type: 'string' } },
                    notes: { type: 'array', items: { type: 'string' } },
                },
                required: [
                    'root',
                    'projects',
                    'artifacts',
                    'layout',
                    'naming',
                    'tests',
                    'configs',
                    'envKeys',
                    'git',
                    'readNext',
                    'notes',
                ],
            },
            render: (_args, value) => [{ type: 'text', text: renderConventions(value) }],
        },
        async execute(args, exec) {
            const input = args;
            if (input.path !== undefined && typeof input.path !== 'string')
                throw new Error('path 必须是字符串：仓库根目录的绝对路径');
            const root = path.resolve(input.path ?? process.cwd());
            if (!existsSync(root))
                throw new Error(`目录不存在：${root}`);
            exec.signal?.throwIfAborted();
            return collectConventions(root);
        },
    };
    ctx.tools.register(conventionsTool);
    // 5) 闭环验证：只执行项目声明的只读检查（lint/typecheck/test），不接受任意命令
    const runChecksTool = {
        name: 'run_checks',
        description: '执行仓库已声明的检查并返回真实结果：lint / typecheck / test / build。命令只来自 package.json scripts、本地 tsc（--noEmit）、go.mod 或 Makefile 的 build 目标，不接受任意命令。build 会写产物（可能触发依赖安装），仅在显式请求时执行；默认只跑 lint/typecheck/test。可用 dryRun 只列出将要执行的命令。',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: '仓库根目录的绝对路径，省略时使用当前工作目录' },
                checks: {
                    type: 'array',
                    items: { type: 'string', enum: ['lint', 'typecheck', 'test', 'build'] },
                    description: '要执行的检查，省略时为 lint/typecheck/test',
                },
                projects: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '只跑指定子项目目录（如 ["web"]），省略时跑全部',
                },
                timeoutMs: {
                    type: 'integer',
                    description: '单项检查超时毫秒，默认 180000，范围 5000-600000',
                },
                stopOnFailure: {
                    type: 'boolean',
                    description: '首项失败后是否停止，默认 true',
                },
                dryRun: {
                    type: 'boolean',
                    description: '只解析并列出将要执行的命令，不真正运行',
                },
            },
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    root: { type: 'string' },
                    results: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                project: { type: 'string' },
                                check: { type: 'string', enum: ['lint', 'typecheck', 'test', 'build'] },
                                command: { type: 'string' },
                                source: { type: 'string' },
                                status: {
                                    type: 'string',
                                    enum: ['passed', 'failed', 'skipped', 'unavailable', 'timeout', 'aborted'],
                                },
                                exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
                                durationMs: { type: 'integer' },
                                outputTail: { type: 'string' },
                                detail: { type: 'string' },
                            },
                            required: [
                                'project',
                                'check',
                                'command',
                                'source',
                                'status',
                                'exitCode',
                                'durationMs',
                                'outputTail',
                                'detail',
                            ],
                        },
                    },
                    notes: { type: 'array', items: { type: 'string' } },
                },
                required: ['root', 'results', 'notes'],
            },
            render: (_args, value) => [{ type: 'text', text: renderChecks(value) }],
        },
        timeoutMs: 600000,
        async execute(args, exec) {
            const input = (args ?? {});
            const root = path.resolve(typeof input.path === 'string' ? input.path : process.cwd());
            if (!existsSync(root))
                throw new Error(`目录不存在：${root}`);
            return runChecks(root, input, exec.signal);
        },
    };
    ctx.tools.register(runChecksTool);
    // 6) 随包分发的 Skill：注册进 ctx.skills（无 skills 服务的组合里自动跳过）
    const skillsDir = fileURLToPath(new URL('../skills', import.meta.url));
    const skills = loadSkills(skillsDir);
    ctx.inject(['skills'], (skillCtx) => {
        for (const skill of skills)
            skillCtx.skills.register(skill);
    });
    console.log('[fullstack-expert] plugin loaded');
}
