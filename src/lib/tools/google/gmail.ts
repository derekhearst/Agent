// Gmail Tools — read-only access to Gmail via Google Workspace API
import { google } from 'googleapis';
import { getGoogleClient, GOOGLE_NOT_CONFIGURED } from './auth';
import type { ToolHandler, ToolExecuteResult } from '$lib/tools/tools';

/** Decode base64url-encoded email body */
function decodeBody(encoded: string): string {
	try {
		return Buffer.from(encoded, 'base64url').toString('utf-8');
	} catch {
		return Buffer.from(encoded, 'base64').toString('utf-8');
	}
}

/** Strip HTML tags for plain-text fallback */
function stripHtml(html: string): string {
	return html
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>/gi, '\n\n')
		.replace(/<\/div>/gi, '\n')
		.replace(/<\/li>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** Get a header value by name from a Gmail message */
function getHeader(
	headers: Array<{ name?: string | null; value?: string | null }> | undefined,
	name: string
): string {
	if (!headers) return '';
	const header = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
	return header?.value ?? '';
}

/**
 * Extract the readable text body from a Gmail message payload.
 * Prefers text/plain, falls back to text/html (stripped).
 */
function extractBody(payload: {
	mimeType?: string | null;
	body?: { data?: string | null } | null;
	parts?: Array<{
		mimeType?: string | null;
		body?: { data?: string | null } | null;
		parts?: Array<{
			mimeType?: string | null;
			body?: { data?: string | null } | null;
		}>;
	}>;
}): string {
	// Direct body (non-multipart)
	if (payload.body?.data && payload.mimeType === 'text/plain') {
		return decodeBody(payload.body.data);
	}

	// Search parts recursively
	if (payload.parts) {
		// First pass: look for text/plain
		for (const part of payload.parts) {
			if (part.mimeType === 'text/plain' && part.body?.data) {
				return decodeBody(part.body.data);
			}
			// Check nested parts (multipart/alternative inside multipart/mixed)
			if (part.parts) {
				for (const nested of part.parts) {
					if (nested.mimeType === 'text/plain' && nested.body?.data) {
						return decodeBody(nested.body.data);
					}
				}
			}
		}

		// Second pass: fallback to text/html
		for (const part of payload.parts) {
			if (part.mimeType === 'text/html' && part.body?.data) {
				return stripHtml(decodeBody(part.body.data));
			}
			if (part.parts) {
				for (const nested of part.parts) {
					if (nested.mimeType === 'text/html' && nested.body?.data) {
						return stripHtml(decodeBody(nested.body.data));
					}
				}
			}
		}
	}

	// Final fallback: raw body data regardless of mime type
	if (payload.body?.data) {
		const raw = decodeBody(payload.body.data);
		return payload.mimeType?.includes('html') ? stripHtml(raw) : raw;
	}

	return '(No readable body found)';
}

/** Extract attachment info from a message payload */
function extractAttachments(payload: {
	parts?: Array<{
		filename?: string | null;
		mimeType?: string | null;
		body?: { size?: number | null };
		parts?: Array<{
			filename?: string | null;
			mimeType?: string | null;
			body?: { size?: number | null };
		}>;
	}>;
}): Array<{ name: string; mimeType: string; size: number }> {
	const attachments: Array<{ name: string; mimeType: string; size: number }> = [];

	function scanParts(parts: typeof payload.parts) {
		if (!parts) return;
		for (const part of parts) {
			if (part.filename && part.filename.length > 0) {
				attachments.push({
					name: part.filename,
					mimeType: part.mimeType ?? 'application/octet-stream',
					size: part.body?.size ?? 0
				});
			}
			if (part.parts) {
				scanParts(part.parts);
			}
		}
	}

	scanParts(payload.parts);
	return attachments;
}

/** Format a byte size into a human-readable string */
function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ──────────────────────────────────────────────
// Tool: search_email
// ──────────────────────────────────────────────

async function searchEmail(query: string, maxResults: number): Promise<ToolExecuteResult> {
	const auth = getGoogleClient();
	if (!auth) return { content: GOOGLE_NOT_CONFIGURED };

	const gmail = google.gmail({ version: 'v1', auth });

	try {
		console.log(`📧 Searching Gmail: "${query}"`);

		const listResponse = await gmail.users.messages.list({
			userId: 'me',
			q: query,
			maxResults
		});

		const messages = listResponse.data.messages;
		if (!messages || messages.length === 0) {
			return { content: `No emails found matching: "${query}"` };
		}

		// Fetch message details in parallel
		const details = await Promise.all(
			messages.map((m) =>
				gmail.users.messages.get({
					userId: 'me',
					id: m.id!,
					format: 'metadata',
					metadataHeaders: ['Subject', 'From', 'Date', 'To']
				})
			)
		);

		const sections: string[] = [`## 📧 Email Search Results for: "${query}"\n`];
		sections.push(`Found ${messages.length} result(s).\n`);
		sections.push('| # | Date | From | Subject | Gmail Message ID |');
		sections.push('|---|------|------|---------|----|');

		for (let i = 0; i < details.length; i++) {
			const msg = details[i].data;
			const headers = msg.payload?.headers ?? [];
			const subject = getHeader(headers, 'Subject') || '(no subject)';
			const from = getHeader(headers, 'From');
			const date = getHeader(headers, 'Date');

			// Parse date to a shorter format
			let shortDate = date;
			try {
				shortDate = new Date(date).toLocaleDateString('en-US', {
					month: 'short',
					day: 'numeric',
					year: 'numeric'
				});
			} catch {
				// Keep original
			}

			sections.push(`| ${i + 1} | ${shortDate} | ${from} | ${subject} | \`${msg.id}\` |`);
		}

		sections.push(
			'\n_To read an email, call read_email with the Gmail Message ID from the table above (NOT any order number or other ID from the subject line)._'
		);

		return { content: sections.join('\n') };
	} catch (error) {
		console.error('Gmail search error:', error);
		return {
			content: `Error searching Gmail: ${error instanceof Error ? error.message : 'Unknown error'}`
		};
	}
}

export const searchEmailTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'search_email',
			description:
				'Search Gmail for emails matching a query. Uses the same query syntax as the Gmail search bar (e.g. "from:boss subject:meeting", "is:unread", "after:2025/01/01 has:attachment"). Returns a list of matching emails with subject, sender, date, and message IDs for further reading.',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description:
							'Gmail search query (supports Gmail search operators like from:, to:, subject:, is:unread, has:attachment, after:, before:, label:, etc.)'
					},
					max_results: {
						type: 'number',
						description: 'Maximum number of results to return (default: 10, max: 50)'
					}
				},
				required: ['query']
			}
		}
	},
	execute: async (args) => {
		const query = args.query as string;
		if (!query) return { content: 'Error: No search query provided.' };
		const maxResults = Math.min((args.max_results as number) ?? 10, 50);
		return searchEmail(query, maxResults);
	}
};

// ──────────────────────────────────────────────
// Tool: read_email
// ──────────────────────────────────────────────

async function readEmail(messageId: string): Promise<ToolExecuteResult> {
	const auth = getGoogleClient();
	if (!auth) return { content: GOOGLE_NOT_CONFIGURED };

	const gmail = google.gmail({ version: 'v1', auth });

	try {
		console.log(`📧 Reading email: ${messageId}`);

		const response = await gmail.users.messages.get({
			userId: 'me',
			id: messageId,
			format: 'full'
		});

		const msg = response.data;
		const headers = msg.payload?.headers ?? [];

		const subject = getHeader(headers, 'Subject') || '(no subject)';
		const from = getHeader(headers, 'From');
		const to = getHeader(headers, 'To');
		const cc = getHeader(headers, 'Cc');
		const date = getHeader(headers, 'Date');

		let formattedDate = date;
		try {
			formattedDate = new Date(date).toLocaleString('en-US', {
				weekday: 'short',
				month: 'short',
				day: 'numeric',
				year: 'numeric',
				hour: 'numeric',
				minute: '2-digit'
			});
		} catch {
			// Keep original
		}

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const body = extractBody(msg.payload as any);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const attachments = extractAttachments(msg.payload as any);

		const sections: string[] = [];
		sections.push(`## 📧 ${subject}\n`);
		sections.push(`**From:** ${from}`);
		sections.push(`**To:** ${to}`);
		if (cc) sections.push(`**CC:** ${cc}`);
		sections.push(`**Date:** ${formattedDate}`);
		sections.push(`**Labels:** ${msg.labelIds?.join(', ') ?? 'none'}`);

		if (attachments.length > 0) {
			sections.push(`\n**Attachments (${attachments.length}):**`);
			for (const att of attachments) {
				sections.push(`- 📎 ${att.name} (${att.mimeType}, ${formatSize(att.size)})`);
			}
		}

		sections.push('\n---\n');

		// Truncate very long email bodies to stay within context limits
		const maxBodyLength = 8000;
		if (body.length > maxBodyLength) {
			sections.push(body.substring(0, maxBodyLength));
			sections.push(`\n\n_... (truncated, ${body.length} total characters)_`);
		} else {
			sections.push(body);
		}

		return { content: sections.join('\n') };
	} catch (error) {
		console.error('Gmail read error:', error);
		return {
			content: `Error reading email: ${error instanceof Error ? error.message : 'Unknown error'}`
		};
	}
}

export const readEmailTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'read_email',
			description:
				'Read the full content of a specific email by its Gmail message ID. Returns the complete email headers (from, to, cc, date, subject), body text, labels, and a list of any attachments. Use search_email or list_emails first to find Gmail message IDs. IMPORTANT: The message_id is a Gmail internal ID (e.g. "194a2b3c4d5e") from the "Gmail Message ID" column — do NOT use order numbers, tracking numbers, or other IDs found in the email subject or body.',
			parameters: {
				type: 'object',
				properties: {
					message_id: {
						type: 'string',
						description:
							'The Gmail message ID (a hex string like "194a2b3c4d5e") from the Gmail Message ID column in search_email or list_emails results. This is NOT an order number or any other ID.'
					}
				},
				required: ['message_id']
			}
		}
	},
	execute: async (args) => {
		const messageId = args.message_id as string;
		if (!messageId) return { content: 'Error: No message_id provided.' };
		return readEmail(messageId);
	}
};

// ──────────────────────────────────────────────
// Tool: list_emails
// ──────────────────────────────────────────────

async function listEmails(
	label: string,
	maxResults: number,
	unreadOnly: boolean
): Promise<ToolExecuteResult> {
	const auth = getGoogleClient();
	if (!auth) return { content: GOOGLE_NOT_CONFIGURED };

	const gmail = google.gmail({ version: 'v1', auth });

	try {
		const query = unreadOnly ? 'is:unread' : undefined;
		console.log(`📧 Listing emails — label: ${label}, unread_only: ${unreadOnly}`);

		const listResponse = await gmail.users.messages.list({
			userId: 'me',
			labelIds: [label],
			q: query,
			maxResults
		});

		const messages = listResponse.data.messages;
		if (!messages || messages.length === 0) {
			return {
				content: `No emails found in ${label}${unreadOnly ? ' (unread only)' : ''}.`
			};
		}

		// Fetch message metadata in parallel
		const details = await Promise.all(
			messages.map((m) =>
				gmail.users.messages.get({
					userId: 'me',
					id: m.id!,
					format: 'metadata',
					metadataHeaders: ['Subject', 'From', 'Date']
				})
			)
		);

		const sections: string[] = [];
		sections.push(`## 📧 ${label} — ${unreadOnly ? 'Unread ' : ''}Emails\n`);
		sections.push(`Showing ${details.length} email(s).\n`);
		sections.push('| # | Date | From | Subject | Unread | Gmail Message ID |');
		sections.push('|---|------|------|---------|--------|----|');

		for (let i = 0; i < details.length; i++) {
			const msg = details[i].data;
			const headers = msg.payload?.headers ?? [];
			const subject = getHeader(headers, 'Subject') || '(no subject)';
			const from = getHeader(headers, 'From');
			const date = getHeader(headers, 'Date');
			const isUnread = msg.labelIds?.includes('UNREAD') ? '●' : '';

			let shortDate = date;
			try {
				shortDate = new Date(date).toLocaleDateString('en-US', {
					month: 'short',
					day: 'numeric'
				});
			} catch {
				// Keep original
			}

			sections.push(
				`| ${i + 1} | ${shortDate} | ${from} | ${subject} | ${isUnread} | \`${msg.id}\` |`
			);
		}

		sections.push(
			'\n_To read an email, call read_email with the Gmail Message ID from the table above (NOT any order number or other ID from the subject line)._'
		);

		return { content: sections.join('\n') };
	} catch (error) {
		console.error('Gmail list error:', error);
		return {
			content: `Error listing emails: ${error instanceof Error ? error.message : 'Unknown error'}`
		};
	}
}

export const listEmailsTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'list_emails',
			description:
				'List recent emails from a Gmail label (default: INBOX). Returns a table of emails with subject, sender, date, and unread status. Common labels: INBOX, SENT, DRAFT, SPAM, TRASH, STARRED, IMPORTANT, or any custom label name.',
			parameters: {
				type: 'object',
				properties: {
					label: {
						type: 'string',
						description:
							'Gmail label to list emails from (default: "INBOX"). Common labels: INBOX, SENT, DRAFT, SPAM, TRASH, STARRED, IMPORTANT.'
					},
					max_results: {
						type: 'number',
						description: 'Maximum number of emails to return (default: 15, max: 50)'
					},
					unread_only: {
						type: 'boolean',
						description: 'If true, only show unread emails (default: false)'
					}
				},
				required: []
			}
		}
	},
	execute: async (args) => {
		const label = (args.label as string) ?? 'INBOX';
		const maxResults = Math.min((args.max_results as number) ?? 15, 50);
		const unreadOnly = (args.unread_only as boolean) ?? false;
		return listEmails(label, maxResults, unreadOnly);
	}
};
