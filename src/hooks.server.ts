// Server hooks — auth gate + agent scheduler
import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { scheduler } from '$lib/agents/agents';

// Initialize the scheduler (loads agents from DB, starts cron jobs)
scheduler.init().catch((err) => {
	console.error('Failed to initialize agent scheduler:', err);
});

export const handle: Handle = async ({ event, resolve }) => {
	const password = env.SITE_PASSWORD;

	// If no password configured, skip auth
	if (!password) return resolve(event);

	// Allow login page and login API through
	const path = event.url.pathname;
	if (path === '/login' || path === '/api/login') {
		return resolve(event);
	}

	// Allow static assets through (but NOT remote function calls)
	if (
		(path.startsWith('/_app/') && !path.startsWith('/_app/remote/')) ||
		path.startsWith('/favicon') ||
		path === '/robots.txt'
	) {
		return resolve(event);
	}

	// Check auth cookie
	const authed = event.cookies.get('site-auth');
	if (authed === password) {
		return resolve(event);
	}

	// Redirect to login
	return new Response(null, {
		status: 302,
		headers: { location: '/login' }
	});
};
