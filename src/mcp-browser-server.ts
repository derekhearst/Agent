#!/usr/bin/env node
/**
 * MCP Server for Browser Interaction
 *
 * Exposes Playwright browser tools via Model Context Protocol.
 * Allows AI assistants to navigate, interact with, and screenshot web pages.
 *
 * Run with: npx tsx src/mcp-browser-server.ts
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	type Tool
} from '@modelcontextprotocol/sdk/types.js';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

// ============== BROWSER MANAGER ==============

interface BrowserSession {
	context: BrowserContext;
	page: Page;
	lastUsed: number;
}

const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes idle → cleanup

class BrowserManager {
	private browser: Browser | null = null;
	private sessions = new Map<string, BrowserSession>();
	private cleanupInterval: ReturnType<typeof setInterval> | null = null;

	async getBrowser(): Promise<Browser> {
		if (this.browser && this.browser.isConnected()) {
			return this.browser;
		}

		console.error('🌐 MCP Browser: Launching headless Chromium...');
		this.browser = await chromium.launch({
			headless: true,
			args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
		});

		if (!this.cleanupInterval) {
			this.cleanupInterval = setInterval(() => this.cleanupIdleSessions(), 60_000);
		}

		return this.browser;
	}

	async getPage(sessionId: string): Promise<Page> {
		const existing = this.sessions.get(sessionId);
		if (existing) {
			existing.lastUsed = Date.now();
			if (!existing.page.isClosed()) {
				return existing.page;
			}
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

	async screenshot(sessionId: string): Promise<string> {
		const page = await this.getPage(sessionId);
		const buffer = await page.screenshot({
			type: 'png',
			fullPage: false
		});
		return buffer.toString('base64');
	}

	async getPageText(sessionId: string): Promise<string> {
		const page = await this.getPage(sessionId);

		const text = await page.evaluate(() => {
			const body = document.body;
			if (!body) return '';

			const clone = body.cloneNode(true) as HTMLElement;
			clone.querySelectorAll('script, style, noscript, svg').forEach((el) => el.remove());

			const rawText = clone.innerText || clone.textContent || '';
			return rawText
				.split('\n')
				.map((line) => line.trim())
				.filter((line) => line.length > 0)
				.join('\n')
				.substring(0, 12000); // Increased for MCP context
		});

		return text;
	}

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
				.slice(0, 40);
		});

		return { title, url, links };
	}

	async getInteractiveElements(sessionId: string): Promise<string> {
		const page = await this.getPage(sessionId);

		return await page.evaluate(() => {
			const elements: string[] = [];

			// Buttons
			document.querySelectorAll('button, [role="button"]').forEach((el, i) => {
				const text = (el as HTMLElement).innerText?.trim().substring(0, 50) || '';
				const id = el.id ? `#${el.id}` : '';
				const className =
					el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : '';
				if (text || id || className) {
					elements.push(`[button ${i + 1}] ${text}${id}${className}`);
				}
			});

			// Links
			document.querySelectorAll('a[href]').forEach((el, i) => {
				const text = (el as HTMLAnchorElement).innerText?.trim().substring(0, 50) || '';
				const href = (el as HTMLAnchorElement).href;
				if (text && href.startsWith('http')) {
					elements.push(`[link ${i + 1}] "${text}" → ${href.substring(0, 80)}`);
				}
			});

			// Input fields
			document.querySelectorAll('input, textarea, select').forEach((el, i) => {
				const input = el as HTMLInputElement;
				const type = input.type || input.tagName.toLowerCase();
				const name = input.name || input.id || input.placeholder || '';
				const label = document.querySelector(`label[for="${input.id}"]`)?.textContent?.trim() || '';
				elements.push(`[input ${i + 1}] ${type}: ${label || name || '(unnamed)'}`);
			});

			return elements.slice(0, 60).join('\n');
		});
	}

	private cleanupIdleSessions() {
		const now = Date.now();
		for (const [id, session] of this.sessions) {
			if (now - session.lastUsed > SESSION_TIMEOUT_MS) {
				console.error(`🌐 MCP Browser: Cleaning up idle session ${id}`);
				session.context.close().catch(() => {});
				this.sessions.delete(id);
			}
		}

		if (this.sessions.size === 0 && this.browser) {
			console.error('🌐 MCP Browser: No active sessions, closing browser');
			this.browser.close().catch(() => {});
			this.browser = null;
		}
	}

	async shutdown() {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}

		for (const [, session] of this.sessions) {
			try {
				await session.context.close();
			} catch {
				// Context already closed
			}
		}
		this.sessions.clear();

		if (this.browser) {
			await this.browser.close().catch(() => {});
			this.browser = null;
		}
	}
}

const browserManager = new BrowserManager();
const DEFAULT_SESSION = 'mcp-default';

// ============== MCP TOOLS ==============

const TOOLS: Tool[] = [
	{
		name: 'browse_url',
		description:
			'Navigate to a URL in a headless browser. Returns the page title, URL, text content, clickable elements, and a screenshot. Use this to visit websites, view UIs, read content, or start a browsing session.',
		inputSchema: {
			type: 'object',
			properties: {
				url: {
					type: 'string',
					description: 'The full URL to navigate to (e.g., "https://example.com")'
				}
			},
			required: ['url']
		}
	},
	{
		name: 'browser_click',
		description:
			'Click on an element on the current page by its visible text, label, or CSS selector. After clicking, returns a screenshot showing the result.',
		inputSchema: {
			type: 'object',
			properties: {
				target: {
					type: 'string',
					description:
						'What to click: visible text (e.g., "Sign In"), button label, link text, or CSS selector (e.g., "#submit-btn", ".nav-link")'
				}
			},
			required: ['target']
		}
	},
	{
		name: 'browser_type',
		description:
			'Type text into an input field on the current page. Identify the field by its placeholder, label, or CSS selector. Returns a screenshot after typing.',
		inputSchema: {
			type: 'object',
			properties: {
				target: {
					type: 'string',
					description: 'The input field to type into: placeholder text, label text, or CSS selector'
				},
				text: {
					type: 'string',
					description: 'The text to type into the field'
				},
				pressEnter: {
					type: 'boolean',
					description: 'Whether to press Enter after typing (default: false)'
				}
			},
			required: ['target', 'text']
		}
	},
	{
		name: 'browser_scroll',
		description: 'Scroll the current page. Returns a screenshot after scrolling.',
		inputSchema: {
			type: 'object',
			properties: {
				direction: {
					type: 'string',
					enum: ['down', 'up', 'top', 'bottom'],
					description: 'Scroll direction: down, up, top (to top of page), or bottom (to bottom)'
				}
			},
			required: ['direction']
		}
	},
	{
		name: 'browser_screenshot',
		description:
			'Take a screenshot of the current browser page. Use this to see the current state of the page without performing any action.',
		inputSchema: {
			type: 'object',
			properties: {},
			required: []
		}
	},
	{
		name: 'browser_get_content',
		description:
			'Get the text content, interactive elements, and metadata from the current page without taking a screenshot. Useful for extracting information.',
		inputSchema: {
			type: 'object',
			properties: {},
			required: []
		}
	},
	{
		name: 'browser_navigate',
		description: 'Navigate browser history or reload. Returns a screenshot after navigation.',
		inputSchema: {
			type: 'object',
			properties: {
				action: {
					type: 'string',
					enum: ['back', 'forward', 'reload'],
					description: 'Navigation action: back, forward, or reload'
				}
			},
			required: ['action']
		}
	},
	{
		name: 'browser_press_key',
		description: 'Press a keyboard key. Useful for Enter, Tab, Escape, arrow keys, etc.',
		inputSchema: {
			type: 'object',
			properties: {
				key: {
					type: 'string',
					description: 'Key to press: Enter, Tab, Escape, ArrowDown, ArrowUp, etc.'
				}
			},
			required: ['key']
		}
	},
	{
		name: 'browser_close',
		description: 'Close the browser session and free resources. Use when done browsing.',
		inputSchema: {
			type: 'object',
			properties: {},
			required: []
		}
	}
];

// ============== TOOL HANDLERS ==============

async function handleBrowseUrl(url: string) {
	const fullUrl = url.startsWith('http') ? url : `https://${url}`;
	console.error(`🌐 MCP: Browsing ${fullUrl}`);

	const page = await browserManager.getPage(DEFAULT_SESSION);
	await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
	await page.waitForTimeout(1500);

	const [info, text, elements, screenshot] = await Promise.all([
		browserManager.getPageInfo(DEFAULT_SESSION),
		browserManager.getPageText(DEFAULT_SESSION),
		browserManager.getInteractiveElements(DEFAULT_SESSION),
		browserManager.screenshot(DEFAULT_SESSION)
	]);

	const linksList = info.links
		.slice(0, 20)
		.map((l) => `• ${l.text} → ${l.href}`)
		.join('\n');

	return {
		content: [
			{
				type: 'text' as const,
				text: `# Page: ${info.title}\nURL: ${info.url}\n\n## Text Content\n${text}\n\n## Interactive Elements\n${elements}\n\n## Links\n${linksList}`
			},
			{
				type: 'image' as const,
				data: screenshot,
				mimeType: 'image/png'
			}
		]
	};
}

async function handleClick(target: string) {
	console.error(`🌐 MCP: Clicking "${target}"`);
	const page = await browserManager.getPage(DEFAULT_SESSION);

	try {
		// Try text-based selection first
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

	await page.waitForTimeout(1000);

	const [info, screenshot] = await Promise.all([
		browserManager.getPageInfo(DEFAULT_SESSION),
		browserManager.screenshot(DEFAULT_SESSION)
	]);

	return {
		content: [
			{
				type: 'text' as const,
				text: `Clicked "${target}"\nNow on: ${info.title} (${info.url})`
			},
			{
				type: 'image' as const,
				data: screenshot,
				mimeType: 'image/png'
			}
		]
	};
}

async function handleType(target: string, text: string, pressEnter: boolean = false) {
	console.error(`🌐 MCP: Typing into "${target}"`);
	const page = await browserManager.getPage(DEFAULT_SESSION);

	try {
		await page
			.getByPlaceholder(target)
			.or(page.getByLabel(target))
			.first()
			.fill(text, { timeout: 10_000 });
	} catch {
		await page.locator(target).first().fill(text, { timeout: 10_000 });
	}

	if (pressEnter) {
		await page.keyboard.press('Enter');
		await page.waitForTimeout(1500);
	} else {
		await page.waitForTimeout(500);
	}

	const [info, screenshot] = await Promise.all([
		browserManager.getPageInfo(DEFAULT_SESSION),
		browserManager.screenshot(DEFAULT_SESSION)
	]);

	return {
		content: [
			{
				type: 'text' as const,
				text: `Typed "${text}" into "${target}"${pressEnter ? ' and pressed Enter' : ''}\nPage: ${info.title} (${info.url})`
			},
			{
				type: 'image' as const,
				data: screenshot,
				mimeType: 'image/png'
			}
		]
	};
}

async function handleScroll(direction: string) {
	console.error(`🌐 MCP: Scrolling ${direction}`);
	const page = await browserManager.getPage(DEFAULT_SESSION);

	switch (direction) {
		case 'down':
			await page.evaluate(() => window.scrollBy(0, window.innerHeight));
			break;
		case 'up':
			await page.evaluate(() => window.scrollBy(0, -window.innerHeight));
			break;
		case 'top':
			await page.evaluate(() => window.scrollTo(0, 0));
			break;
		case 'bottom':
			await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
			break;
	}

	await page.waitForTimeout(500);
	const screenshot = await browserManager.screenshot(DEFAULT_SESSION);

	return {
		content: [
			{ type: 'text' as const, text: `Scrolled ${direction}` },
			{ type: 'image' as const, data: screenshot, mimeType: 'image/png' }
		]
	};
}

async function handleScreenshot() {
	console.error('🌐 MCP: Taking screenshot');
	const [info, screenshot] = await Promise.all([
		browserManager.getPageInfo(DEFAULT_SESSION),
		browserManager.screenshot(DEFAULT_SESSION)
	]);

	return {
		content: [
			{
				type: 'text' as const,
				text: `Screenshot of: ${info.title} (${info.url})`
			},
			{
				type: 'image' as const,
				data: screenshot,
				mimeType: 'image/png'
			}
		]
	};
}

async function handleGetContent() {
	console.error('🌐 MCP: Getting page content');
	const [info, text, elements] = await Promise.all([
		browserManager.getPageInfo(DEFAULT_SESSION),
		browserManager.getPageText(DEFAULT_SESSION),
		browserManager.getInteractiveElements(DEFAULT_SESSION)
	]);

	const linksList = info.links.map((l) => `• ${l.text} → ${l.href}`).join('\n');

	return {
		content: [
			{
				type: 'text' as const,
				text: `# ${info.title}\nURL: ${info.url}\n\n## Text Content\n${text}\n\n## Interactive Elements\n${elements}\n\n## Links\n${linksList}`
			}
		]
	};
}

async function handleNavigate(action: string) {
	console.error(`🌐 MCP: Navigate ${action}`);
	const page = await browserManager.getPage(DEFAULT_SESSION);

	switch (action) {
		case 'back':
			await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15_000 });
			break;
		case 'forward':
			await page.goForward({ waitUntil: 'domcontentloaded', timeout: 15_000 });
			break;
		case 'reload':
			await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
			break;
	}

	await page.waitForTimeout(1000);

	const [info, screenshot] = await Promise.all([
		browserManager.getPageInfo(DEFAULT_SESSION),
		browserManager.screenshot(DEFAULT_SESSION)
	]);

	return {
		content: [
			{ type: 'text' as const, text: `Navigated ${action}\nNow on: ${info.title} (${info.url})` },
			{ type: 'image' as const, data: screenshot, mimeType: 'image/png' }
		]
	};
}

async function handlePressKey(key: string) {
	console.error(`🌐 MCP: Pressing key ${key}`);
	const page = await browserManager.getPage(DEFAULT_SESSION);
	await page.keyboard.press(key);
	await page.waitForTimeout(500);

	const [info, screenshot] = await Promise.all([
		browserManager.getPageInfo(DEFAULT_SESSION),
		browserManager.screenshot(DEFAULT_SESSION)
	]);

	return {
		content: [
			{ type: 'text' as const, text: `Pressed ${key}\nPage: ${info.title} (${info.url})` },
			{ type: 'image' as const, data: screenshot, mimeType: 'image/png' }
		]
	};
}

async function handleClose() {
	console.error('🌐 MCP: Closing browser session');
	await browserManager.closePage(DEFAULT_SESSION);
	return { content: [{ type: 'text' as const, text: 'Browser session closed.' }] };
}

// ============== SERVER SETUP ==============

const server = new Server(
	{
		name: 'browser-tools',
		version: '1.0.0'
	},
	{
		capabilities: {
			tools: {}
		}
	}
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
	return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name, arguments: args } = request.params;

	try {
		switch (name) {
			case 'browse_url':
				return await handleBrowseUrl(args?.url as string);

			case 'browser_click':
				return await handleClick(args?.target as string);

			case 'browser_type':
				return await handleType(
					args?.target as string,
					args?.text as string,
					args?.pressEnter as boolean
				);

			case 'browser_scroll':
				return await handleScroll(args?.direction as string);

			case 'browser_screenshot':
				return await handleScreenshot();

			case 'browser_get_content':
				return await handleGetContent();

			case 'browser_navigate':
				return await handleNavigate(args?.action as string);

			case 'browser_press_key':
				return await handlePressKey(args?.key as string);

			case 'browser_close':
				return await handleClose();

			default:
				return {
					content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
					isError: true
				};
		}
	} catch (error) {
		const msg = error instanceof Error ? error.message : 'Unknown error';
		console.error(`🌐 MCP Error in ${name}: ${msg}`);

		// Try to get a screenshot on error
		try {
			const screenshot = await browserManager.screenshot(DEFAULT_SESSION);
			return {
				content: [
					{ type: 'text' as const, text: `Error: ${msg}` },
					{ type: 'image' as const, data: screenshot, mimeType: 'image/png' }
				],
				isError: true
			};
		} catch {
			return {
				content: [{ type: 'text' as const, text: `Error: ${msg}` }],
				isError: true
			};
		}
	}
});

// Graceful shutdown
process.on('SIGINT', async () => {
	console.error('🌐 MCP Browser: Shutting down...');
	await browserManager.shutdown();
	process.exit(0);
});

process.on('SIGTERM', async () => {
	await browserManager.shutdown();
	process.exit(0);
});

// Start the server
async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error('🌐 MCP Browser Server running on stdio');
}

main().catch((error) => {
	console.error('Failed to start MCP server:', error);
	process.exit(1);
});
