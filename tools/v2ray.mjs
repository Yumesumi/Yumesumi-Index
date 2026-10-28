/* =========================================================
   tools/v2ray.mjs — V2rayN 控制与代理故障转移

   用法：
     node tools/v2ray.mjs status              查看当前状态
     node tools/v2ray.mjs start               启动 V2rayN 并开启自动配置系统代理
     node tools/v2ray.mjs stop                停止 V2rayN
     node tools/v2ray.mjs nodes               列出节点（按延迟排序）
     node tools/v2ray.mjs use <序号|名称>     切换到指定节点
     node tools/v2ray.mjs ensure [最多尝试数]  确保代理可用；不通则自动换节点重试
     node tools/v2ray.mjs test [网址]         测试代理连通性

   实现要点：
     · 不直接写注册表。系统代理由 V2rayN 自己设置——官方行为是
       「每次启动/重启服务时强制应用」。因此改配置后重启它即可。
     · 节点数据从 V2rayN 的 SQLite 库只读读取（node:sqlite，零依赖）。
     · 切节点必须重启 V2rayN：核心配置由它生成，直接改 config.json
       会丢掉路由规则与出站参数。
     · 所有操作可逆：配置改动前备份到同目录 .bak。
   ========================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/* ---------------- 配置路径 ---------------- */

const V2RAYN_DIR = process.env.V2RAYN_DIR || 'D:/Software/v2rayN-windows-64';
const EXE = path.join(V2RAYN_DIR, 'v2rayN.exe');
const GUI_DIR = path.join(V2RAYN_DIR, 'guiConfigs');
const CONFIG_FILE = path.join(GUI_DIR, 'guiNConfig.json');
const DB_FILE = path.join(GUI_DIR, 'guiNDB.db');
const BACKUP_FILE = path.join(GUI_DIR, 'guiNConfig.json.bak');

const PROXY_PORT = 10808;
const PROXY_HOST = '127.0.0.1';
const TEST_URL = 'https://github.com';

/* 系统代理模式（对应 V2rayN 的 ESysProxyType） */
const SYS_PROXY = {
  0: 'ForcedClear 清除系统代理',
  1: 'ForcedChange 自动配置系统代理',
  2: 'Unchanged 不改变系统代理',
  3: 'Pac PAC 自动配置脚本',
};

/* ---------------- 输出 ---------------- */

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const out = (s = '') => process.stdout.write(`${s}\n`);
const ok = (s) => out(`${C.green}✓${C.reset} ${s}`);
const bad = (s) => out(`${C.red}✗${C.reset} ${s}`);
const warn = (s) => out(`${C.yellow}!${C.reset} ${s}`);
const info = (s) => out(`${C.dim}${s}${C.reset}`);
const step = (s) => out(`${C.cyan}›${C.reset} ${s}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 基础操作 ---------------- */

function isRunning(name) {
  const r = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/NH'], { encoding: 'utf-8' });
  return new RegExp(name.replace(/\./g, '\\.'), 'i').test(r.stdout || '');
}

const v2rayRunning = () => isRunning('v2rayN.exe');
const coreRunning = () => isRunning('xray.exe');

function killProcess(name) {
  try {
    execFileSync('taskkill', ['/F', '/IM', name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

function writeConfig(cfg) {
  if (fs.existsSync(CONFIG_FILE) && !fs.existsSync(BACKUP_FILE)) {
    fs.copyFileSync(CONFIG_FILE, BACKUP_FILE);
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

/**
 * 启动 V2rayN。
 * 用 cmd /c start 让它脱离当前进程，避免随命令结束被回收。
 */
function launchV2rayN() {
  const child = spawn('cmd', ['/c', 'start', '""', EXE], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

/** 测试代理能否访问目标站点 */
function testProxy(url = TEST_URL) {
  const r = spawnSync('curl', [
    '-s', '-m', '12', '--proxy', `http://${PROXY_HOST}:${PROXY_PORT}`,
    '-o', '/dev/null', '-w', '%{http_code}', url,
  ], { encoding: 'utf-8' });
  const code = r.stdout?.trim() || '000';
  return { ok: code === '200', code };
}

/** 等待代理就绪 */
async function waitForProxy(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (testProxy().ok) return true;
    await sleep(1200);
  }
  return false;
}

/* ---------------- 节点读取 ---------------- */

/** 这些备注是订阅信息，不是真正的节点 */
const NOT_A_NODE = /剩余流量|套餐到期|过期|过滤|最新版本|官网|订阅|更新/i;

function readNodes() {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch {
    return [];
  }
  let db;
  try {
    db = new DatabaseSync(DB_FILE, { readOnly: true });
    const rows = db.prepare(`
      SELECT p.IndexId AS indexId, p.Remarks AS remarks, p.Address AS address,
             p.Port AS port, e.Delay AS delay
      FROM ProfileItem p
      LEFT JOIN ProfileExItem e ON p.IndexId = e.IndexId
    `).all();
    return rows
      .filter((r) => r.remarks && !NOT_A_NODE.test(r.remarks))
      .map((r) => ({
        indexId: r.indexId,
        remarks: r.remarks,
        address: r.address,
        port: r.port,
        delay: Number.isFinite(r.delay) ? r.delay : null,
      }))
      .sort((a, b) => (a.delay ?? 1e9) - (b.delay ?? 1e9));
  } catch {
    return [];
  } finally {
    try { db?.close(); } catch { /* 忽略 */ }
  }
}

/* ---------------- 核心动作 ---------------- */

/**
 * 重启 V2rayN。
 * 顺序很重要：必须先关闭（退出时它会把内存中的配置写回磁盘），
 * 再修改配置文件，最后启动。启动时 V2rayN 会自己应用系统代理设置。
 */
async function restartV2rayN({ sysProxyType, indexId } = {}) {
  if (v2rayRunning()) {
    step('关闭 V2rayN…');
    killProcess('v2rayN.exe');
    await sleep(1500);
  }
  if (coreRunning()) killProcess('xray.exe');
  await sleep(600);

  if (sysProxyType !== undefined || indexId !== undefined) {
    step('更新配置…');
    const cfg = readConfig();
    if (sysProxyType !== undefined) cfg.SystemProxyItem.SysProxyType = sysProxyType;
    if (indexId !== undefined) cfg.IndexId = indexId;
    writeConfig(cfg);
  }

  step('启动 V2rayN…');
  launchV2rayN();
  await sleep(2500);
}

/** 切换到指定节点并重启 */
async function switchNode(indexId) {
  await restartV2rayN({ indexId });
  return waitForProxy();
}

/* ---------------- 子命令 ---------------- */

async function cmdStatus() {
  const cfg = readConfig();
  const nodes = readNodes();
  const current = nodes.find((n) => n.indexId === cfg.IndexId);
  const mode = SYS_PROXY[cfg.SystemProxyItem.SysProxyType] || '未知';
  const t = testProxy();

  out(`${C.bold}V2rayN 状态${C.reset}`);
  out(`  安装目录  ${V2RAYN_DIR}`);
  out(`  进程      ${v2rayRunning() ? '运行中' : '未运行'}${coreRunning() ? '（核心在线）' : ''}`);
  out(`  系统代理  ${mode}`);
  out(`  当前节点  ${current ? `${current.remarks}（${current.delay ?? '?'}ms）` : cfg.IndexId}`);
  out(`  本地代理  ${PROXY_HOST}:${PROXY_PORT}（mixed，HTTP 与 SOCKS5 通用）`);
  out(`  连通性    ${t.ok ? `${C.green}正常${C.reset}` : `${C.red}异常 (${t.code})${C.reset}`}`);
  out(`  节点总数  ${nodes.length}`);
}

async function cmdStart() {
  step('启动 V2rayN 并开启自动配置系统代理…');
  await restartV2rayN({ sysProxyType: 1 });
  const working = await waitForProxy();
  if (working) {
    ok('已启动，自动配置系统代理已生效');
    info(`本地代理 ${PROXY_HOST}:${PROXY_PORT}`);
  } else {
    bad('启动后代理仍不可用');
    info('可尝试：node tools/v2ray.mjs ensure（会自动换节点重试）');
    process.exitCode = 1;
  }
}

async function cmdStop() {
  step('停止 V2rayN…');
  killProcess('v2rayN.exe');
  killProcess('xray.exe');
  await sleep(800);
  ok('已停止');
}

function cmdNodes() {
  const nodes = readNodes();
  const cfg = readConfig();
  out(`${C.bold}节点列表（共 ${nodes.length} 个）${C.reset}`);
  nodes.forEach((n, i) => {
    const cur = n.indexId === cfg.IndexId ? `${C.green} ← 当前${C.reset}` : '';
    const d = n.delay ? `${String(n.delay).padStart(5)}ms` : '    ?  ';
    out(`  ${String(i + 1).padStart(2)}. ${d}  ${n.remarks}${cur}`);
  });
}

async function cmdUse(target) {
  const nodes = readNodes();
  let chosen;
  if (/^\d+$/.test(target)) {
    chosen = nodes[Number(target) - 1];
  } else {
    chosen = nodes.find((n) => n.remarks.includes(target));
  }
  if (!chosen) {
    bad(`未找到节点：${target}`);
    info('用 node tools/v2ray.mjs nodes 查看可用节点');
    process.exitCode = 1;
    return;
  }
  step(`切换到「${chosen.remarks}」…`);
  const working = await switchNode(chosen.indexId);
  if (working) {
    ok(`已切换并验证连通：${chosen.remarks}`);
  } else {
    bad(`切换到「${chosen.remarks}」后代理仍不可用`);
    process.exitCode = 1;
  }
}

/**
 * 确保代理可用：按延迟顺序逐个尝试节点。
 * 当前节点先试；不通则逐个切换重试，直到有一个能用。
 *
 * 说明：由本脚本启动的 V2rayN 会随命令结束被回收，这是运行环境的限制。
 * 因此本函数的价值在于「在当前命令内把代理弄可用」——
 * 例如包住一次 git push。若需要代理长期常驻，请手动启动 V2rayN。
 */
async function cmdEnsure(opts = {}) {
  const nodes = readNodes();
  if (!nodes.length) {
    bad('读不到节点列表');
    process.exitCode = 1;
    return false;
  }

  const cfg = readConfig();
  const current = nodes.find((n) => n.indexId === cfg.IndexId);

  // 当前节点先试一次
  if (current) {
    step(`测试当前节点「${current.remarks}」…`);
    const t = testProxy();
    if (t.ok) {
      ok(`当前节点可用：${current.remarks}`);
      if (cfg.SystemProxyItem.SysProxyType !== 1) {
        info('补开自动配置系统代理…');
        await restartV2rayN({ sysProxyType: 1 });
        await waitForProxy();
      }
      return true;
    }
    warn(`当前节点不通（HTTP ${t.code}）`);
  }

  const tried = new Set(current ? [current.indexId] : []);
  let attempts = 0;

  for (const node of nodes) {
    if (tried.has(node.indexId)) continue;
    if (opts.maxNodes && attempts >= opts.maxNodes) break;
    attempts += 1;

    step(`尝试节点 ${attempts}/${nodes.length}：${node.remarks}${node.delay ? `（${node.delay}ms）` : ''}…`);
    const working = await switchNode(node.indexId);
    if (working) {
      ok(`节点可用：${node.remarks}`);
      info('已切换并开启自动配置系统代理');
      return true;
    }
    warn(`${node.remarks} 不通，尝试下一个…`);
  }

  bad(`所有 ${attempts} 个节点都不可用`);
  process.exitCode = 1;
  return false;
}

/**
 * 在代理可用的前提下执行一条命令。
 * 用于 git push 这类需要网络的命令：代理不通时先自动换节点。
 */
async function cmdWithProxy(args) {
  if (!args.length) {
    bad('缺少要执行的命令');
    process.exitCode = 1;
    return;
  }
  const ready = await cmdEnsure({});
  if (!ready) {
    bad('代理不可用，命令未执行');
    process.exitCode = 1;
    return;
  }
  info(`执行：${args.join(' ')}`);
  const proxy = `http://${PROXY_HOST}:${PROXY_PORT}`;
  const r = spawnSync(args[0], args.slice(1), {
    stdio: 'inherit',
    env: {
      ...process.env,
      // 必须同时覆盖大写与小写：git 优先读 HTTPS_PROXY，
      // 遗留的旧代理值会让 CONNECT 隧道失败
      HTTP_PROXY: proxy,
      http_proxy: proxy,
      HTTPS_PROXY: proxy,
      https_proxy: proxy,
    },
  });
  process.exitCode = r.status ?? 1;
}

function cmdTest(url) {
  const t = testProxy(url || TEST_URL);
  if (t.ok) {
    ok(`代理正常（${url || TEST_URL} → HTTP ${t.code}）`);
  } else {
    bad(`代理不可用（${url || TEST_URL} → HTTP ${t.code}）`);
    process.exitCode = 1;
  }
}

/* ---------------- 入口 ---------------- */

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'status': await cmdStatus(); break;
  case 'start': await cmdStart(); break;
  case 'stop': await cmdStop(); break;
  case 'nodes': cmdNodes(); break;
  case 'use': await cmdUse(args[0]); break;
  case 'ensure': await cmdEnsure({ maxNodes: Number(args[0]) || undefined }); break;
  case 'test': cmdTest(args[0]); break;
  case 'with-proxy': await cmdWithProxy(args); break;
  default:
    out(`${C.bold}V2rayN 控制工具${C.reset}

  node tools/v2ray.mjs status              查看状态
  node tools/v2ray.mjs start               启动并开启自动配置系统代理
  node tools/v2ray.mjs stop                停止
  node tools/v2ray.mjs nodes               列出节点
  node tools/v2ray.mjs use <序号|名称>     切换节点
  node tools/v2ray.mjs ensure [最多尝试数]  确保可用，不通则自动换节点
  node tools/v2ray.mjs test [网址]         测试连通性
  node tools/v2ray.mjs with-proxy <命令...> 在代理可用时执行命令（不通则先换节点）

  说明：
   · 本脚本不直接写注册表。系统代理由 V2rayN 自身在启动时设置
     （官方行为：每次启动/重启时强制应用），因此改配置后需重启它。
   · 由本脚本启动的 V2rayN 会随命令结束被回收。需要代理长期常驻，
     请手动启动 V2rayN，或用 with-proxy 把网络命令包在同一次执行里。`);
    if (command) process.exit(1);
}
