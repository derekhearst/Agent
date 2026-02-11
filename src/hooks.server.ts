// Server hooks — initialize the agent scheduler on server startup
import { scheduler } from '$lib/agents/agents';

// Initialize the scheduler (loads agents from DB, starts cron jobs)
scheduler.init().catch((err) => {
	console.error('Failed to initialize agent scheduler:', err);
});
