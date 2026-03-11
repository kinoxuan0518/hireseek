import type { Page } from 'playwright';

export interface DetectionResult {
  detected: boolean;
  type?: 'captcha' | 'login_expired' | 'rate_limit' | 'network_error';
  message?: string;
  suggestedAction?: string;
}

/**
 * 检测页面是否出现验证码
 */
export async function detectCaptcha(page: Page): Promise<DetectionResult> {
  try {
    // 常见验证码特征
    const captchaSelectors = [
      'iframe[src*="captcha"]',
      'iframe[src*="recaptcha"]',
      '.captcha',
      '#captcha',
      '[class*="verify"]',
      '[id*="verify"]',
      'text=/请完成验证/',
      'text=/安全验证/',
      'text=/滑动验证/',
    ];

    for (const selector of captchaSelectors) {
      const element = await page.locator(selector).first().count();
      if (element > 0) {
        return {
          detected: true,
          type: 'captcha',
          message: '检测到验证码',
          suggestedAction: '请在浏览器中完成验证，然后按 Enter 继续',
        };
      }
    }

    return { detected: false };
  } catch (err) {
    // 检测失败不影响主流程
    return { detected: false };
  }
}

/**
 * 检测登录是否过期
 */
export async function detectLoginExpired(page: Page, channel: string): Promise<DetectionResult> {
  try {
    const url = page.url();

    // 检测是否被重定向到登录页
    const loginPatterns = [
      /login/i,
      /signin/i,
      /passport/i,
      /auth/i,
    ];

    const isLoginPage = loginPatterns.some(pattern => pattern.test(url));

    if (isLoginPage) {
      return {
        detected: true,
        type: 'login_expired',
        message: '登录已过期，需要重新登录',
        suggestedAction: '请在浏览器中重新登录，然后按 Enter 继续',
      };
    }

    // 检测页面中的登录提示
    const loginTexts = [
      'text=/请登录/',
      'text=/立即登录/',
      'text=/登录已过期/',
      'text=/请先登录/',
    ];

    for (const selector of loginTexts) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        return {
          detected: true,
          type: 'login_expired',
          message: '登录已过期',
          suggestedAction: '请重新登录',
        };
      }
    }

    return { detected: false };
  } catch (err) {
    return { detected: false };
  }
}

/**
 * 检测是否触发触达限制
 */
export async function detectRateLimit(page: Page): Promise<DetectionResult> {
  try {
    const rateLimitTexts = [
      'text=/今日沟通已达上限/',
      'text=/触达上限/',
      'text=/请明天再试/',
      'text=/操作过于频繁/',
      'text=/请稍后再试/',
    ];

    for (const selector of rateLimitTexts) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        return {
          detected: true,
          type: 'rate_limit',
          message: '触发平台触达限制',
          suggestedAction: '今日触达已达上限，建议明天继续',
        };
      }
    }

    return { detected: false };
  } catch (err) {
    return { detected: false };
  }
}

/**
 * 检测网络错误
 */
export async function detectNetworkError(page: Page): Promise<DetectionResult> {
  try {
    const errorTexts = [
      'text=/网络错误/',
      'text=/连接失败/',
      'text=/请检查网络/',
      'text=/服务器错误/',
      'text=/500/',
      'text=/502/',
      'text=/503/',
    ];

    for (const selector of errorTexts) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        return {
          detected: true,
          type: 'network_error',
          message: '网络错误',
          suggestedAction: '检查网络连接后重试',
        };
      }
    }

    return { detected: false };
  } catch (err) {
    return { detected: false };
  }
}

/**
 * 综合检测所有可能的错误
 */
export async function detectErrors(page: Page, channel: string): Promise<DetectionResult> {
  const checks = [
    await detectCaptcha(page),
    await detectLoginExpired(page, channel),
    await detectRateLimit(page),
    await detectNetworkError(page),
  ];

  // 返回第一个检测到的错误
  for (const result of checks) {
    if (result.detected) {
      return result;
    }
  }

  return { detected: false };
}
