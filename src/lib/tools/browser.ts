// Browser Manager — singleton Playwright browser for agent tools
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

interface BrowserSession {
	context: BrowserContext;
	page: Page;
	lastUsed: number;
}

const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes idle → cleanup

class BrowserManager {
	private browser: Browser | null = null;
	private sessions = new Map<string, BrowserSession>();
	private cleanupInterval: ReturnType<typeof setInterval> | null = null;

	/** Lazy-launch headless Chromium, reused across all sessions */
	async getBrowser(): Promise<Browser> {
		if (this.browser && this.browser.isConnected()) {
			return this.browser;
		}

		console.log('🌐 Browser Manager: Launching headless Chromium...');
		this.browser = await chromium.launch({
			headless: true,
			args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
		});

		// Start cleanup interval
		if (!this.cleanupInterval) {
			this.cleanupInterval = setInterval(() => this.cleanupIdleSessions(), 60_000);
		}

		return this.browser;
	}

	/**
	 * Get or create a browser page for a given session ID.
	 * Each agent run / chat session gets its own isolated context + page.
	 */
	async getPage(sessionId: string): Promise<Page> {
		const existing = this.sessions.get(sessionId);
		if (existing) {
			existing.lastUsed = Date.now();
			// Make sure page is still open
			if (!existing.page.isClosed()) {
				return existing.page;
			}
			// Page was closed, create a new one in the same context
			const page = await existing.context.newPage();
			existing.page = page;
			return page;
		}

		const browser = await this.getBrowser();
		const context = await browser.newContext({
			viewport: { width: 1280, height: 720 },
			userAgent:
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
		});
		const page = await context.newPage();

		this.sessions.set(sessionId, {
			context,
			page,
			lastUsed: Date.now()
		});

		return page;
	}

	/** Close and remove a specific session */
	async closePage(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (session) {
			try {
				await session.context.close();
			} catch {
				// already closed
			}
			this.sessions.delete(sessionId);
		}
	}

	/** Take a screenshot of the current page, returns base64 PNG */
	async screenshot(sessionId: string): Promise<string> {
		const page = await this.getPage(sessionId);
		const buffer = await page.screenshot({
			type: 'png',
			fullPage: false // viewport only — keeps size reasonable
		});
		return buffer.toString('base64');
	}

	/** Get readable text content from the current page */
	async getPageText(sessionId: string): Promise<string> {
		const page = await this.getPage(sessionId);

		const text = await page.evaluate(() => {
			// Extract meaningful text content, skip scripts/styles
			const body = document.body;
			if (!body) return '';

			// Remove script and style elements from consideration
			const clone = body.cloneNode(true) as HTMLElement;
			clone.querySelectorAll('script, style, noscript, svg').forEach((el) => el.remove());

			// Get text content, collapse whitespace
			const rawText = clone.innerText || clone.textContent || '';
			return rawText
				.split('\n')
				.map((line) => line.trim())
				.filter((line) => line.length > 0)
				.join('\n')
				.substring(0, 8000); // Cap at 8k chars to avoid token explosion
		});

		return text;
	}

	/** Get page metadata (title, url, links) */
	async getPageInfo(sessionId: string): Promise<{
		title: string;
		url: string;
		links: Array<{ text: string; href: string }>;
	}> {
		const page = await this.getPage(sessionId);

		const title = await page.title();
		const url = page.url();

		const links = await page.evaluate(() => {
			const anchors = Array.from(document.querySelectorAll('a[href]'));
			return anchors
				.map((a) => ({
					text: (a.textContent || '').trim().substring(0, 100),
					href: (a as HTMLAnchorElement).href
				}))
				.filter((l) => l.text && l.href && l.href.startsWith('http'))
				.slice(0, 30); // Top 30 links
		});

		return { title, url, links };
	}

	/** Cleanup idle sessions */
	private cleanupIdleSessions() {
		const now = Date.now();
		for (const [id, session] of this.sessions) {
			if (now - session.lastUsed > SESSION_TIMEOUT_MS) {
				console.log(`🌐 Browser Manager: Cleaning up idle session ${id}`);
				session.context.close().catch(() => {});
				this.sessions.delete(id);
			}
		}

		// If no sessions left, close the browser
		if (this.sessions.size === 0 && this.browser) {
			console.log('🌐 Browser Manager: No active sessions, closing browser');
			this.browser.close().catch(() => {});
			this.browser = null;
		}
	}

	/** Shut down everything */
	async shutdown() {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}

		for (const [id, session] of this.sessions) {
			try {
				await session.context.close();
			} catch {
				// ignore
			}
			this.sessions.delete(id);
		}

		if (this.browser) {
			await this.browser.close().catch(() => {});
			this.browser = null;
		}
	}
}

// HMR-safe singleton (same pattern as scheduler)
const globalBrowser = globalThis as unknown as { __browserManager?: BrowserManager };
if (!globalBrowser.__browserManager) {
	globalBrowser.__browserManager = new BrowserManager();
}

const browserManager = globalBrowser.__browserManager;

// ============== BROWSER TOOLS ==============

import type { ToolHandler, ToolExecuteResult } from '$lib/tools/tools';

/**
 * Generate a session ID for the current tool call context.
 * In practice, the agent runner passes a sessionId through tool args,
 * but we fall back to a shared default session.
 */
function getSessionId(args: Record<string, unknown>): string {
	return (args._browserSessionId as string) || 'default';
}

// ─── browse_url ──────────────────────────────────────────────────────────────
// Navigate to a URL, return page text + screenshot

async function browseUrl(url: string, sessionId: string): Promise<ToolExecuteResult> {
	try {
		console.log(`🌐 Browsing: ${url}`);
		const page = await browserManager.getPage(sessionId);

		await page.goto(url, {
			waitUntil: 'domcontentloaded',
			timeout: 30_000
		});

		// Wait a moment for dynamic content
		await page.waitForTimeout(1500);

		const [info, text, screenshot] = await Promise.all([
			browserManager.getPageInfo(sessionId),
			browserManager.getPageText(sessionId),
			browserManager.screenshot(sessionId)
		]);

		const linksList = info.links
			.slice(0, 15)
			.map((l) => `- [${l.text}](${l.href})`)
			.join('\n');

		const content = `## Page: ${info.title}\nURL: ${info.url}\n\n### Content\n${text}\n\n### Links on Page\n${linksList}`;

		return {
			content,
			images: [{ mimeType: 'image/png', base64: screenshot }],
			meta: { sources: [{ title: info.title, url: info.url }] }
		};
	} catch (error) {
		const msg = error instanceof Error ? error.message : 'Navigation failed';
		console.error(`🌐 Browse error: ${msg}`);
		return { content: `Error navigating to ${url}: ${msg}` };
	}
}

export const browseUrlTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'browse_url',
			description:
				'Navigate to a URL in a browser and return the page content along with a screenshot. Use this to visit websites, read articles, check pages, or start a browsing session. Returns the page text, links, and a visual screenshot.',
			parameters: {
				type: 'object',
				properties: {
					url: {
						type: 'string',
						description: 'The full URL to navigate to (e.g. "https://example.com")'
					}
				},
				required: ['url']
			}
		}
	},
	execute: async (args) => {
		const url = args.url as string;
		if (!url) return { content: 'Error: No URL provided.' };
		// Ensure URL has a protocol
		const fullUrl = url.startsWith('http') ? url : `https://${url}`;
		return browseUrl(fullUrl, getSessionId(args));
	}
};

// ─── browser_act ─────────────────────────────────────────────────────────────
// Perform actions on the current page (click, type, scroll, etc.)

async function browserAct(
	action: string,
	value: string | undefined,
	sessionId: string
): Promise<ToolExecuteResult> {
	try {
		console.log(`🌐 Browser action: ${action}${value ? ` (value: ${value})` : ''}`);
		const page = await browserManager.getPage(sessionId);

		// Parse the action instruction and execute it
		const actionLower = action.toLowerCase();

		if (actionLower.startsWith('click')) {
			// Extract the target from the instruction
			const target = action.replace(/^click\s+(on\s+)?/i, '').trim();
			if (target.startsWith('//') || target.startsWith('xpath=')) {
				// XPath selector
				const xpath = target.replace('xpath=', '');
				await page.locator(`xpath=${xpath}`).first().click({ timeout: 10_000 });
			} else {
				// Try text-based click first, fall back to CSS selector
				try {
					await page
						.getByRole('link', { name: target })
						.or(page.getByRole('button', { name: target }))
						.or(page.getByText(target, { exact: false }))
						.first()
						.click({ timeout: 10_000 });
				} catch {
					// Fall back to CSS selector
					await page.locator(target).first().click({ timeout: 10_000 });
				}
			}
		} else if (actionLower.startsWith('type') || actionLower.startsWith('fill')) {
			const target = action.replace(/^(type|fill)\s+(in(to)?\s+)?/i, '').trim();
			const inputValue = value || '';
			try {
				// Try by placeholder/label first
				await page
					.getByPlaceholder(target)
					.or(page.getByLabel(target))
					.first()
					.fill(inputValue, { timeout: 10_000 });
			} catch {
				// Fall back to CSS selector
				await page.locator(target).first().fill(inputValue, { timeout: 10_000 });
			}
		} else if (actionLower.startsWith('scroll down')) {
			await page.evaluate(() => window.scrollBy(0, window.innerHeight));
		} else if (actionLower.startsWith('scroll up')) {
			await page.evaluate(() => window.scrollBy(0, -window.innerHeight));
		} else if (actionLower.startsWith('scroll to top')) {
			await page.evaluate(() => window.scrollTo(0, 0));
		} else if (actionLower.startsWith('scroll to bottom')) {
			await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		} else if (actionLower.startsWith('go back') || actionLower.startsWith('back')) {
			await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15_000 });
		} else if (actionLower.startsWith('go forward') || actionLower.startsWith('forward')) {
			await page.goForward({ waitUntil: 'domcontentloaded', timeout: 15_000 });
		} else if (actionLower.startsWith('reload') || actionLower.startsWith('refresh')) {
			await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
		} else if (actionLower.startsWith('press') || actionLower.startsWith('key')) {
			const key = action.replace(/^(press|key)\s+/i, '').trim();
			await page.keyboard.press(key);
		} else if (actionLower.startsWith('wait')) {
			const ms = parseInt(action.replace(/\D/g, '')) || 2000;
			await page.waitForTimeout(Math.min(ms, 10_000)); // Cap at 10s
		} else if (actionLower.startsWith('select') || actionLower.startsWith('choose')) {
			const parts = action.replace(/^(select|choose)\s+/i, '').trim();
			// Try to parse "option from selector" pattern
			const fromMatch = parts.match(/(.+?)\s+from\s+(.+)/i);
			if (fromMatch) {
				const [, optionText, selector] = fromMatch;
				try {
					await page.getByLabel(selector.trim()).first().selectOption({ label: optionText.trim() });
				} catch {
					await page.locator(selector.trim()).first().selectOption({ label: optionText.trim() });
				}
			}
		} else {
			// Generic: try to find and click text
			try {
				await page.getByText(action, { exact: false }).first().click({ timeout: 10_000 });
			} catch {
				return {
					content: `Could not perform action: "${action}". Try being more specific or use commands like: click [target], type [target] (with value), scroll down/up, go back, press [key].`
				};
			}
		}

		// Wait for the page to settle after the action
		await page.waitForTimeout(1000);

		const [info, screenshot] = await Promise.all([
			browserManager.getPageInfo(sessionId),
			browserManager.screenshot(sessionId)
		]);

		return {
			content: `Action performed: "${action}"\nCurrent page: ${info.title} (${info.url})`,
			images: [{ mimeType: 'image/png', base64: screenshot }],
			meta: { sources: [{ title: info.title, url: info.url }] }
		};
	} catch (error) {
		const msg = error instanceof Error ? error.message : 'Action failed';
		console.error(`🌐 Browser action error: ${msg}`);

		// Still try to get a screenshot to show what happened
		try {
			const screenshot = await browserManager.screenshot(sessionId);
			return {
				content: `Action failed: "${action}" — ${msg}\nHere's what the page looks like:`,
				images: [{ mimeType: 'image/png', base64: screenshot }]
			};
		} catch {
			return { content: `Action failed: "${action}" — ${msg}` };
		}
	}
}

export const browserActTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'browser_act',
			description: `Perform an action on the current browser page. Supports:
- click [target]: Click a button, link, or element by visible text, label, or CSS selector
- type [target] with value param: Type text into an input field
- scroll down / scroll up / scroll to top / scroll to bottom
- go back / go forward / reload  
- press [key]: Press a keyboard key (Enter, Tab, Escape, etc.)
- wait [ms]: Wait for a duration

After each action, returns a screenshot showing the result. Use browse_url first to navigate to a page.`,
			parameters: {
				type: 'object',
				properties: {
					action: {
						type: 'string',
						description:
							'The action to perform, e.g. "click Sign In", "type search box", "scroll down", "press Enter"'
					},
					value: {
						type: 'string',
						description: 'Optional value for type/fill actions — the text to type into the field'
					}
				},
				required: ['action']
			}
		}
	},
	execute: async (args) => {
		const action = args.action as string;
		if (!action) return { content: 'Error: No action specified.' };
		const value = args.value as string | undefined;
		return browserAct(action, value, getSessionId(args));
	}
};

// ─── browser_extract ─────────────────────────────────────────────────────────
// Extract specific information from the current page

async function browserExtract(instruction: string, sessionId: string): Promise<ToolExecuteResult> {
	try {
		console.log(`🌐 Browser extract: ${instruction}`);

		const [text, info, screenshot] = await Promise.all([
			browserManager.getPageText(sessionId),
			browserManager.getPageInfo(sessionId),
			browserManager.screenshot(sessionId)
		]);

		const linksList = info.links
			.slice(0, 20)
			.map((l) => `- [${l.text}](${l.href})`)
			.join('\n');

		const content = `## Extraction from: ${info.title}\nURL: ${info.url}\nInstruction: ${instruction}\n\n### Full Page Text\n${text}\n\n### All Links\n${linksList}`;

		return {
			content,
			images: [{ mimeType: 'image/png', base64: screenshot }],
			meta: { sources: [{ title: info.title, url: info.url }] }
		};
	} catch (error) {
		const msg = error instanceof Error ? error.message : 'Extraction failed';
		return { content: `Error extracting from page: ${msg}` };
	}
}

export const browserExtractTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'browser_extract',
			description:
				'Extract specific information from the current browser page. Returns the full page text, links, and a screenshot. Use this after browse_url to pull out data you need. The model will interpret the page content based on your instruction.',
			parameters: {
				type: 'object',
				properties: {
					instruction: {
						type: 'string',
						description:
							'What to extract from the page, e.g. "get all product prices", "find the contact email", "list the main headlines"'
					}
				},
				required: ['instruction']
			}
		}
	},
	execute: async (args) => {
		const instruction = args.instruction as string;
		if (!instruction) return { content: 'Error: No extraction instruction provided.' };
		return browserExtract(instruction, getSessionId(args));
	}
};

// ─── browser_screenshot ──────────────────────────────────────────────────────
// Take a screenshot of the current page

export const browserScreenshotTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'browser_screenshot',
			description:
				'Take a screenshot of the current browser page. Use this to see what the page looks like without performing any action. Useful to check the result of a previous action or see the current state.',
			parameters: {
				type: 'object',
				properties: {},
				required: []
			}
		}
	},
	execute: async (args) => {
		const sessionId = getSessionId(args);
		try {
			const [info, screenshot] = await Promise.all([
				browserManager.getPageInfo(sessionId),
				browserManager.screenshot(sessionId)
			]);

			return {
				content: `Screenshot of: ${info.title} (${info.url})`,
				images: [{ mimeType: 'image/png', base64: screenshot }],
				meta: { sources: [{ title: info.title, url: info.url }] }
			};
		} catch (error) {
			const msg = error instanceof Error ? error.message : 'Screenshot failed';
			return { content: `Error taking screenshot: ${msg}` };
		}
	}
};

// ─── browser_close ───────────────────────────────────────────────────────────
// Close the browser session

export const browserCloseTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'browser_close',
			description:
				'Close the current browser session and free resources. Use this when you are done browsing and no longer need the browser.',
			parameters: {
				type: 'object',
				properties: {},
				required: []
			}
		}
	},
	execute: async (args) => {
		const sessionId = getSessionId(args);
		try {
			await browserManager.closePage(sessionId);
			return { content: 'Browser session closed.' };
		} catch (error) {
			const msg = error instanceof Error ? error.message : 'Close failed';
			return { content: `Error closing browser: ${msg}` };
		}
	}
};
