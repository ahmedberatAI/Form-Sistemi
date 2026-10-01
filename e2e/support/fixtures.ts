// Test dosyası başına taze, tohumlu sunucu: beforeAll'da şablon verinin kopyasıyla başlatılır, afterAll'da kapatılır.
// Başarısız testlere sunucu günlüğü eklenir. Senaryo adımları birbirine bağlı olduğundan dosyalar seri kipte koşar.
import { test } from "@playwright/test";
import { Api } from "./api";
import { startServer, type TestServer } from "./server";

export interface SeededServer {
  readonly server: TestServer;
  readonly api: Api;
}

export function useSeededServer(name: string): SeededServer {
  let server: TestServer | null = null;
  let api: Api | null = null;
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(150_000);
    server = await startServer({ name, parallelIndex: testInfo.parallelIndex });
    api = new Api(server.baseURL);
  });

  test.afterEach(async ({}, testInfo) => {
    if (server && testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach("server.log", { path: server.logFile, contentType: "text/plain" }).catch(() => undefined);
    }
  });

  test.afterAll(async () => {
    await server?.stop();
    server = null;
  });

  return {
    get server() {
      if (!server) throw new Error("Test sunucusu başlatılmadı");
      return server;
    },
    get api() {
      if (!api) throw new Error("Test sunucusu başlatılmadı");
      return api;
    },
  };
}
