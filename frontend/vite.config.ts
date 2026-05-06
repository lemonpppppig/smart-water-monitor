import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // 同一份代码通过 VITE_REGION / REGION_CODE 切换 regions/<code>/map 数据
  const region = env.VITE_REGION || env.REGION_CODE || 'ganzhou'

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        // 指向仓库根的 regions/<region>，供 base/river/roads 等组件读取
        '@region': path.resolve(__dirname, `../regions/${region}`),
        '@regions': path.resolve(__dirname, '../regions'),
      },
    },
    define: {
      __REGION_CODE__: JSON.stringify(region),
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
        '/health': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
  }
})
