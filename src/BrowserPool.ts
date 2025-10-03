import { chromium, type Browser, type LaunchOptions } from 'playwright';

interface PooledBrowser {
  browser: Browser;
  inUse: boolean;
  lastUsed: number;
}

export function getChromiumLaunchOptions(): LaunchOptions {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (executablePath) {
    return {
      headless: true,
      executablePath,
    };
  }

  return { headless: true };
}

export class BrowserPool {
  private pool: PooledBrowser[] = [];
  private readonly maxSize: number;
  private readonly idleTimeout: number;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(maxSize = 3, idleTimeoutMs = 60_000) {
    this.maxSize = maxSize;
    this.idleTimeout = idleTimeoutMs;
  }

  async acquire(): Promise<Browser> {
    // Find an available browser in the pool
    const available = this.pool.find(pb => !pb.inUse);

    if (available) {
      available.inUse = true;
      available.lastUsed = Date.now();
      return available.browser;
    }

    // Create a new browser if pool not at max capacity
    if (this.pool.length < this.maxSize) {
      const browser = await chromium.launch(getChromiumLaunchOptions());
      const pooled: PooledBrowser = {
        browser,
        inUse: true,
        lastUsed: Date.now(),
      };
      this.pool.push(pooled);
      return browser;
    }

    // Wait for a browser to become available
    return new Promise<Browser>((resolve) => {
      const checkInterval = setInterval(() => {
        const available = this.pool.find(pb => !pb.inUse);
        if (available) {
          clearInterval(checkInterval);
          available.inUse = true;
          available.lastUsed = Date.now();
          resolve(available.browser);
        }
      }, 100);
    });
  }

  release(browser: Browser): void {
    const pooled = this.pool.find(pb => pb.browser === browser);
    if (pooled) {
      pooled.inUse = false;
      pooled.lastUsed = Date.now();
    }
  }

  startCleanup(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      this.pool = this.pool.filter(pb => {
        if (!pb.inUse && now - pb.lastUsed > this.idleTimeout) {
          pb.browser.close().catch(() => {});
          return false;
        }
        return true;
      });
    }, 30_000); // Run cleanup every 30 seconds
  }

  async closeAll(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    await Promise.all(
      this.pool.map(pb => pb.browser.close().catch(() => {}))
    );
    this.pool = [];
  }
}

// Singleton instance for reuse
let globalPool: BrowserPool | undefined;

export function getBrowserPool(): BrowserPool {
  if (!globalPool) {
    globalPool = new BrowserPool();
    globalPool.startCleanup();
  }
  return globalPool;
}

export async function closeBrowserPool(): Promise<void> {
  if (globalPool) {
    await globalPool.closeAll();
    globalPool = undefined;
  }
}
