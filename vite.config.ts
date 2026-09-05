/// <reference types="vitest/config" />
// المرجع أعلاه يوسّع أنواع إعدادات Vite ليقبل قسم `test` — **إشارة أنواع
// فقط**، تُمحى عند التنفيذ. ولا يُستورد `vitest/config` بدلًا من `vite`
// لأن ذلك يجعل تحميل ملف الإعدادات يعتمد على حزمة تطوير، فينكسر البناء في
// بيئة لا تُثبِّت حزم التطوير (Netlify مثلًا لو ضُبط على الإنتاج).
import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { createServer } from "./server";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    fs: {
      allow: ["./client", "./shared", "index.html"],
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "server/**"],
    },
  },
  build: {
    outDir: "dist/spa",
  },
  plugins: [react(), expressPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
  // اختبارات الوحدة لا تتصل بـSupabase ولا يجوز أن تحتاج مفاتيحه: أيّ ملف
  // يستورد `client/lib/supabase` يُنفّذ الحارس الذي يرمي حين تغيب المفاتيح،
  // فيسقط الاختبار عند الاستيراد قبل أن يبدأ. قيمتان صوريّتان هنا تكفيان،
  // **والحارس في الإنتاج يبقى كما هو** — لا يُضعَّف ليمرّ اختبار.
  test: {
    env: {
      VITE_SUPABASE_URL: "http://localhost:54321",
      VITE_SUPABASE_ANON_KEY: "test-anon-key-not-a-real-credential",
    },
  },
}));

function expressPlugin(): Plugin {
  return {
    name: "express-plugin",
    apply: "serve", // Only apply during development (serve mode)
    configureServer(server) {
      const app = createServer();

      // Add Express app as middleware to Vite dev server
      server.middlewares.use(app);
    },
  };
}
