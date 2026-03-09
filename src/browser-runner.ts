import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { config } from './config';

let browser: Browser | null = null;
let context: BrowserContext | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: config.browser.headless,
      slowMo: config.browser.slowMo,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
      ],
    });
  }
  return browser;
}

export async function getPage(): Promise<Page> {
  const b = await getBrowser();

  if (!context) {
    context = await b.newContext({
      viewport: config.browser.viewport,
      // 模拟正常浏览器 UA，降低反爬风险
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/122.0.0.0 Safari/537.36',
    });
  }

  const pages = context.pages();
  return pages.length > 0 ? pages[0] : await context.newPage();
}

export async function takeScreenshot(page: Page): Promise<string> {
  const buffer = await page.screenshot({ type: 'jpeg', quality: 75 });
  return buffer.toString('base64');
}

export async function executeAction(
  page: Page,
  action: {
    action: string;
    coordinate?: [number, number];
    text?: string;
    direction?: string;
    amount?: number;
  }
): Promise<string> {
  switch (action.action) {
    case 'left_click': {
      const [x, y] = action.coordinate!;
      await page.mouse.click(x, y);
      await page.waitForTimeout(600);
      return `点击 (${x}, ${y})`;
    }

    case 'right_click': {
      const [x, y] = action.coordinate!;
      await page.mouse.click(x, y, { button: 'right' });
      return `右键 (${x}, ${y})`;
    }

    case 'double_click': {
      const [x, y] = action.coordinate!;
      await page.mouse.dblclick(x, y);
      await page.waitForTimeout(400);
      return `双击 (${x}, ${y})`;
    }

    case 'type': {
      await page.keyboard.type(action.text || '', { delay: 60 });
      return `输入文字`;
    }

    case 'key': {
      await page.keyboard.press(action.text || '');
      await page.waitForTimeout(300);
      return `按键 ${action.text}`;
    }

    case 'scroll': {
      // 先把鼠标移到视口中心，再滚动
      const { width, height } = config.browser.viewport;
      if (action.coordinate) {
        await page.mouse.move(action.coordinate[0], action.coordinate[1]);
      } else {
        await page.mouse.move(width / 2, height / 2);
      }
      const delta = action.amount || 500;
      const dx =
        action.direction === 'right' ? delta : action.direction === 'left' ? -delta : 0;
      const dy =
        action.direction === 'down' ? delta : action.direction === 'up' ? -delta : 0;
      await page.mouse.wheel(dx, dy);
      await page.waitForTimeout(400);
      return `滚动 ${action.direction} ${delta}px`;
    }

    case 'move': {
      const [x, y] = action.coordinate!;
      await page.mouse.move(x, y);
      return `移动到 (${x}, ${y})`;
    }

    default:
      return `未知操作: ${action.action}`;
  }
}

export async function closeBrowser(): Promise<void> {
  if (context) {
    await context.close();
    context = null;
  }
  if (browser) {
    await browser.close();
    browser = null;
  }
}
