#!/usr/bin/env bun
/**
 * Google OAuth2 Setup Script
 *
 * One-time setup to obtain a refresh token for Google Workspace API access.
 * Run with: bun run google:setup
 *
 * Prerequisites:
 * 1. Create a Google Cloud project at https://console.cloud.google.com
 * 2. Enable the Gmail API, Google Calendar API, Google Drive API, and People API
 * 3. Create OAuth2 credentials (Desktop app or Web app with http://localhost:3333/callback)
 * 4. Download the credentials and note the Client ID and Client Secret
 */

import { google } from 'googleapis';
import { createServer } from 'http';
import { URL } from 'url';
import * as readline from 'readline';

const REDIRECT_URI = 'http://localhost:3333/callback';
const PORT = 3333;

// All scopes for full workspace read-only access (requested upfront so user only auths once)
const SCOPES = [
	'https://www.googleapis.com/auth/gmail.readonly',
	'https://www.googleapis.com/auth/calendar.readonly',
	'https://www.googleapis.com/auth/drive.readonly',
	'https://www.googleapis.com/auth/contacts.readonly'
];

function prompt(question: string): Promise<string> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

async function main() {
	console.log('🔐 Google Workspace OAuth2 Setup\n');
	console.log('This script will help you obtain a refresh token for Google API access.');
	console.log('You only need to run this once.\n');
	console.log('Prerequisites:');
	console.log('  1. Go to https://console.cloud.google.com');
	console.log('  2. Create or select a project');
	console.log('  3. Enable: Gmail API, Google Calendar API, Google Drive API, People API');
	console.log('  4. Go to Credentials → Create OAuth 2.0 Client ID');
	console.log(`  5. Add ${REDIRECT_URI} as an authorized redirect URI\n`);

	const clientId = await prompt('Enter your Google Client ID: ');
	if (!clientId) {
		console.error('❌ Client ID is required.');
		process.exit(1);
	}

	const clientSecret = await prompt('Enter your Google Client Secret: ');
	if (!clientSecret) {
		console.error('❌ Client Secret is required.');
		process.exit(1);
	}

	const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

	const authUrl = oauth2Client.generateAuthUrl({
		access_type: 'offline',
		scope: SCOPES,
		prompt: 'consent' // Force consent to ensure we get a refresh token
	});

	console.log('\n📋 Opening authorization URL...\n');
	console.log(authUrl);
	console.log('\nIf the browser does not open automatically, copy and paste the URL above.\n');

	// Try to open the browser
	try {
		const { exec } = await import('child_process');
		const platform = process.platform;
		if (platform === 'win32') exec(`start "" "${authUrl}"`);
		else if (platform === 'darwin') exec(`open "${authUrl}"`);
		else exec(`xdg-open "${authUrl}"`);
	} catch {
		// Silently fail — user can copy/paste the URL
	}

	// Start local server to catch the callback
	const code = await new Promise<string>((resolve, reject) => {
		const server = createServer((req, res) => {
			const url = new URL(req.url!, `http://localhost:${PORT}`);

			if (url.pathname === '/callback') {
				const code = url.searchParams.get('code');
				const error = url.searchParams.get('error');

				if (error) {
					res.writeHead(400, { 'Content-Type': 'text/html' });
					res.end(`<h1>❌ Authorization failed</h1><p>${error}</p>`);
					server.close();
					reject(new Error(`Authorization failed: ${error}`));
					return;
				}

				if (code) {
					res.writeHead(200, { 'Content-Type': 'text/html' });
					res.end(
						'<h1>✅ Authorization successful!</h1><p>You can close this window and return to the terminal.</p>'
					);
					server.close();
					resolve(code);
					return;
				}
			}

			res.writeHead(404);
			res.end('Not found');
		});

		server.listen(PORT, () => {
			console.log(`⏳ Waiting for authorization callback on http://localhost:${PORT}...\n`);
		});

		// Timeout after 5 minutes
		setTimeout(() => {
			server.close();
			reject(new Error('Timed out waiting for authorization callback (5 minutes).'));
		}, 300_000);
	});

	console.log('🔄 Exchanging authorization code for tokens...\n');

	const { tokens } = await oauth2Client.getToken(code);

	if (!tokens.refresh_token) {
		console.error(
			'❌ No refresh token received. Try revoking access at https://myaccount.google.com/permissions and running this script again.'
		);
		process.exit(1);
	}

	console.log('✅ Success! Add these to your .env file:\n');
	console.log('# Google Workspace OAuth2');
	console.log(`GOOGLE_CLIENT_ID=${clientId}`);
	console.log(`GOOGLE_CLIENT_SECRET=${clientSecret}`);
	console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
	console.log('');
	console.log('🎉 Setup complete! Restart your dev server to activate Google Workspace tools.');
}

main().catch((err) => {
	console.error('❌ Setup failed:', err.message);
	process.exit(1);
});
