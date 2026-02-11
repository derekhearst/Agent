// Google Calendar Tools — read-only access to Google Calendar via Workspace API
import { google } from 'googleapis';
import { getGoogleClient, GOOGLE_NOT_CONFIGURED } from './auth';
import type { ToolHandler, ToolExecuteResult } from '$lib/tools/tools';

/** Format a calendar event's time range */
function formatEventTime(event: {
	start?: { dateTime?: string | null; date?: string | null };
	end?: { dateTime?: string | null; date?: string | null };
}): { start: string; end: string; allDay: boolean } {
	const startDateTime = event.start?.dateTime;
	const startDate = event.start?.date;
	const endDateTime = event.end?.dateTime;
	const endDate = event.end?.date;

	if (startDate && !startDateTime) {
		// All-day event
		return {
			start: startDate,
			end: endDate ?? startDate,
			allDay: true
		};
	}

	const startDt = new Date(startDateTime!);
	const endDt = new Date(endDateTime!);

	return {
		start: startDt.toLocaleString('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}),
		end: endDt.toLocaleString('en-US', {
			hour: 'numeric',
			minute: '2-digit'
		}),
		allDay: false
	};
}

// ──────────────────────────────────────────────
// Tool: list_calendar_events
// ──────────────────────────────────────────────

async function listCalendarEvents(
	daysAhead: number,
	calendarId: string,
	maxResults: number
): Promise<ToolExecuteResult> {
	const auth = getGoogleClient();
	if (!auth) return { content: GOOGLE_NOT_CONFIGURED };

	const calendar = google.calendar({ version: 'v3', auth });

	try {
		const now = new Date();
		const future = new Date();
		future.setDate(future.getDate() + daysAhead);

		console.log(`📅 Listing calendar events — next ${daysAhead} days`);

		const response = await calendar.events.list({
			calendarId,
			timeMin: now.toISOString(),
			timeMax: future.toISOString(),
			maxResults,
			singleEvents: true,
			orderBy: 'startTime'
		});

		const events = response.data.items;
		if (!events || events.length === 0) {
			return { content: `No events found in the next ${daysAhead} day(s).` };
		}

		const sections: string[] = [];
		sections.push(`## 📅 Calendar — Next ${daysAhead} Day(s)\n`);
		sections.push(`Found ${events.length} event(s).\n`);

		// Group events by date
		const grouped = new Map<string, typeof events>();
		for (const event of events) {
			let dateKey: string;
			if (event.start?.date) {
				dateKey = event.start.date;
			} else if (event.start?.dateTime) {
				dateKey = new Date(event.start.dateTime).toLocaleDateString('en-US', {
					weekday: 'long',
					month: 'long',
					day: 'numeric',
					year: 'numeric'
				});
			} else {
				dateKey = 'Unknown';
			}

			if (!grouped.has(dateKey)) grouped.set(dateKey, []);
			grouped.get(dateKey)!.push(event);
		}

		for (const [dateKey, dayEvents] of grouped) {
			sections.push(`### ${dateKey}\n`);

			for (const event of dayEvents) {
				const time = formatEventTime(event);
				const title = event.summary ?? '(no title)';

				if (time.allDay) {
					sections.push(`- 🗓️ **${title}** — All day`);
				} else {
					sections.push(`- 🕐 **${title}** — ${time.start} – ${time.end}`);
				}

				if (event.location) {
					sections.push(`  📍 ${event.location}`);
				}

				if (event.description) {
					const desc = event.description.substring(0, 200);
					sections.push(`  _${desc}${event.description.length > 200 ? '...' : ''}_`);
				}

				if (event.hangoutLink) {
					sections.push(`  🔗 Meet: ${event.hangoutLink}`);
				}

				const attendees = event.attendees;
				if (attendees && attendees.length > 0 && attendees.length <= 10) {
					const names = attendees
						.map((a) => {
							const status =
								a.responseStatus === 'accepted'
									? '✅'
									: a.responseStatus === 'declined'
										? '❌'
										: a.responseStatus === 'tentative'
											? '❓'
											: '⏳';
							return `${status} ${a.displayName ?? a.email}`;
						})
						.join(', ');
					sections.push(`  👥 ${names}`);
				} else if (attendees && attendees.length > 10) {
					sections.push(`  👥 ${attendees.length} attendees`);
				}

				sections.push('');
			}
		}

		return { content: sections.join('\n') };
	} catch (error) {
		console.error('Calendar list error:', error);
		return {
			content: `Error listing calendar events: ${error instanceof Error ? error.message : 'Unknown error'}`
		};
	}
}

export const listCalendarEventsTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'list_calendar_events',
			description:
				'List upcoming Google Calendar events. Returns events grouped by day with title, time, location, description, Google Meet links, and attendees with RSVP status. Use when the user asks about their schedule, upcoming meetings, or calendar.',
			parameters: {
				type: 'object',
				properties: {
					days_ahead: {
						type: 'number',
						description: 'Number of days ahead to look for events (default: 7, max: 30)'
					},
					calendar_id: {
						type: 'string',
						description:
							'The calendar ID to query (default: "primary"). Use "primary" for the main calendar.'
					},
					max_results: {
						type: 'number',
						description: 'Maximum number of events to return (default: 20, max: 100)'
					}
				},
				required: []
			}
		}
	},
	execute: async (args) => {
		const daysAhead = Math.min((args.days_ahead as number) ?? 7, 30);
		const calendarId = (args.calendar_id as string) ?? 'primary';
		const maxResults = Math.min((args.max_results as number) ?? 20, 100);
		return listCalendarEvents(daysAhead, calendarId, maxResults);
	}
};

// ──────────────────────────────────────────────
// Tool: check_availability
// ──────────────────────────────────────────────

async function checkAvailability(
	date: string,
	startHour?: number,
	endHour?: number
): Promise<ToolExecuteResult> {
	const auth = getGoogleClient();
	if (!auth) return { content: GOOGLE_NOT_CONFIGURED };

	const calendar = google.calendar({ version: 'v3', auth });

	try {
		// Parse the target date
		const targetDate = new Date(date + 'T00:00:00');
		if (isNaN(targetDate.getTime())) {
			return { content: `Error: Invalid date format "${date}". Use YYYY-MM-DD.` };
		}

		const dayStart = new Date(targetDate);
		dayStart.setHours(startHour ?? 8, 0, 0, 0); // Default: 8 AM

		const dayEnd = new Date(targetDate);
		dayEnd.setHours(endHour ?? 18, 0, 0, 0); // Default: 6 PM

		console.log(
			`📅 Checking availability: ${date} (${dayStart.getHours()}:00 - ${dayEnd.getHours()}:00)`
		);

		const response = await calendar.freebusy.query({
			requestBody: {
				timeMin: dayStart.toISOString(),
				timeMax: dayEnd.toISOString(),
				items: [{ id: 'primary' }]
			}
		});

		const busySlots = response.data.calendars?.primary?.busy ?? [];

		const sections: string[] = [];
		const dateStr = targetDate.toLocaleDateString('en-US', {
			weekday: 'long',
			month: 'long',
			day: 'numeric',
			year: 'numeric'
		});
		sections.push(`## 📅 Availability — ${dateStr}\n`);
		sections.push(`Checking ${dayStart.getHours()}:00 – ${dayEnd.getHours()}:00\n`);

		if (busySlots.length === 0) {
			sections.push('✅ **You are free all day!** No events found during this time range.');
			return { content: sections.join('\n') };
		}

		// Format busy slots
		sections.push(`### Busy Times (${busySlots.length} block(s))\n`);
		for (const slot of busySlots) {
			const busyStart = new Date(slot.start!);
			const busyEnd = new Date(slot.end!);
			const startStr = busyStart.toLocaleTimeString('en-US', {
				hour: 'numeric',
				minute: '2-digit'
			});
			const endStr = busyEnd.toLocaleTimeString('en-US', {
				hour: 'numeric',
				minute: '2-digit'
			});
			const durationMin = Math.round((busyEnd.getTime() - busyStart.getTime()) / 60000);
			sections.push(`- 🔴 **${startStr} – ${endStr}** (${durationMin} min)`);
		}

		// Calculate free windows
		sections.push('\n### Free Windows\n');
		let currentStart = dayStart;
		const freeSlots: Array<{ start: Date; end: Date }> = [];

		for (const slot of busySlots) {
			const busyStart = new Date(slot.start!);
			if (busyStart > currentStart) {
				freeSlots.push({ start: new Date(currentStart), end: busyStart });
			}
			const busyEnd = new Date(slot.end!);
			if (busyEnd > currentStart) {
				currentStart = busyEnd;
			}
		}

		if (currentStart < dayEnd) {
			freeSlots.push({ start: new Date(currentStart), end: dayEnd });
		}

		if (freeSlots.length === 0) {
			sections.push('❌ No free time available in this range.');
		} else {
			for (const slot of freeSlots) {
				const startStr = slot.start.toLocaleTimeString('en-US', {
					hour: 'numeric',
					minute: '2-digit'
				});
				const endStr = slot.end.toLocaleTimeString('en-US', {
					hour: 'numeric',
					minute: '2-digit'
				});
				const durationMin = Math.round((slot.end.getTime() - slot.start.getTime()) / 60000);
				const hours = Math.floor(durationMin / 60);
				const mins = durationMin % 60;
				const durationStr = hours > 0 ? `${hours}h${mins > 0 ? ` ${mins}m` : ''}` : `${mins}m`;
				sections.push(`- 🟢 **${startStr} – ${endStr}** (${durationStr})`);
			}
		}

		return { content: sections.join('\n') };
	} catch (error) {
		console.error('Calendar availability error:', error);
		return {
			content: `Error checking availability: ${error instanceof Error ? error.message : 'Unknown error'}`
		};
	}
}

export const checkAvailabilityTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'check_availability',
			description:
				'Check free/busy status on Google Calendar for a specific date. Returns a breakdown of busy time blocks and available free windows. Use when the user asks if they are free, available, or wants to find open time slots for meetings.',
			parameters: {
				type: 'object',
				properties: {
					date: {
						type: 'string',
						description: 'The date to check in YYYY-MM-DD format (e.g. "2026-02-15")'
					},
					start_hour: {
						type: 'number',
						description: 'Start of the time range to check (0-23, default: 8 for 8 AM)'
					},
					end_hour: {
						type: 'number',
						description: 'End of the time range to check (0-23, default: 18 for 6 PM)'
					}
				},
				required: ['date']
			}
		}
	},
	execute: async (args) => {
		const date = args.date as string;
		if (!date) return { content: 'Error: No date provided. Use YYYY-MM-DD format.' };
		const startHour = args.start_hour as number | undefined;
		const endHour = args.end_hour as number | undefined;
		return checkAvailability(date, startHour, endHour);
	}
};
