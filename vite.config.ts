import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite 模板未引入 Node 类型，这里只读取 Tauri 开发主机环境变量。
// @ts-expect-error process 是 Node.js 全局变量
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],

  // 避免 Vite 清屏遮住 Rust 编译错误。
  clearScreen: false,
  // Tauri devUrl 固定为 5174，端口不可用时直接失败。
  server: {
    port: 5174,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 避免监听 Rust 构建目录导致重复刷新。
      ignored: ["**/src-tauri/**"],
    },
  },
}));
