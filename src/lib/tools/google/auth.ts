// Google OAuth2 Authentication — shared singleton client for all Google Workspace tools
import { env } from '$env/dynamic/private';
import { google } from 'googleapis';

let oauthClient: InstanceType<typeof google.auth.OAuth2> | null = null;

/**
 * Get an authenticated Google OAuth2 client.
 * Returns null if credentials are not configured.
 * The client auto-refreshes access tokens using the stored refresh token.
 */
export function getGoogleClient(): InstanceType<typeof google.auth.OAuth2> | null {
	const clientId = env.GOOGLE_CLIENT_ID;
	const clientSecret = env.GOOGLE_CLIENT_SECRET;
	const refreshToken = env.GOOGLE_REFRESH_TOKEN;

	if (!clientId || !clientSecret || !refreshToken) {
		console.warn(
			'⚠️ Google Workspace not configured. Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REFRESH_TOKEN.'
		);
		return null;
	}

	if (!oauthClient) {
		oauthClient = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:3333/callback');
		oauthClient.setCredentials({ refresh_token: refreshToken });
	}

	return oauthClient;
}

/** Error message returned when Google is not configured */
export const GOOGLE_NOT_CONFIGURED =
	'Error: Google Workspace is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in your .env file. Run `bun run google:setup` for first-time setup.';
