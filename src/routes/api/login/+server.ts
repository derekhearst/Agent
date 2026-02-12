import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const { password } = await request.json();
	const sitePassword = env.SITE_PASSWORD;

	if (!sitePassword || password !== sitePassword) {
		return json({ error: 'Invalid password' }, { status: 401 });
	}

	cookies.set('site-auth', sitePassword, {
		path: '/',
		httpOnly: true,
		sameSite: 'strict',
		maxAge: 60 * 60 * 24 * 30 // 30 days
	});

	return json({ success: true });
};
