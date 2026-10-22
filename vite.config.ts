import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // 监听所有网卡，允许平台预览代理（外部域名）访问
    host: true,
    allowedHosts: true,
  },
})
