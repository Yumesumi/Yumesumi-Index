import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const repo = process.cwd();

/**
 * 站点数据与自定义域名不在 public/ 内：
 *   · data/ 同时被 Node 工具读写，保持仓库根路径不变
 *   · CNAME 由 GitHub Pages 自定义域名使用，必须出现在 dist 根
 * 构建结束后复制到产物，开发时 Vite 直接读取仓库根文件。
 */
function copyDeployFiles() {
  let outDir = path.resolve(repo, 'dist');
  return {
    name: 'ysi-copy-deploy-files',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(repo, config.build.outDir || 'dist');
    },
    closeBundle() {
      const dataDir = path.join(repo, 'data');
      if (fs.existsSync(dataDir)) {
        fs.cpSync(dataDir, path.join(outDir, 'data'), { recursive: true });
      }
      for (const file of ['CNAME', '.nojekyll']) {
        const source = path.join(repo, file);
        if (fs.existsSync(source)) fs.copyFileSync(source, path.join(outDir, file));
      }
    },
  };
}

export default defineConfig({
  /** 自定义域名部署在根路径；子路径部署时用 YSI_BASE=/repo/ 覆盖 */
  base: process.env.YSI_BASE || '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
  },
  plugins: [copyDeployFiles()],
  server: {
    host: '127.0.0.1',
    port: 8099,
  },
  preview: {
    host: '127.0.0.1',
    port: 8099,
  },
});
