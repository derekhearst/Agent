import { json } from '@sveltejs/kit';
import type { RequestEvent } from './$types';
import { PDFParse } from 'pdf-parse';

export const POST = async ({ request }: RequestEvent) => {
	try {
		const formData = await request.formData();
		const file = formData.get('file') as File;

		if (!file || file.type !== 'application/pdf') {
			return json({ error: 'A PDF file is required' }, { status: 400 });
		}

		const buffer = Buffer.from(await file.arrayBuffer());
		const parser = new PDFParse({ data: buffer });

		// Get regular text content
		const parsed = await parser.getText();
		let text = parsed.text;

		// Also extract form field data (for fillable PDFs like D&D character sheets)
		try {
			const doc = await parser.load();

			// Try getFieldObjects first (returns all form fields with values)
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const fieldObjects = await (doc as any).getFieldObjects?.();
			if (fieldObjects && Object.keys(fieldObjects).length > 0) {
				const formFields: string[] = ['\n\n--- FORM FIELD DATA ---'];
				for (const [fieldName, fieldEntries] of Object.entries(fieldObjects)) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const entries = fieldEntries as any[];
					for (const entry of entries) {
						const value = entry.value ?? entry.fieldValue ?? '';
						if (value && String(value).trim()) {
							formFields.push(`${fieldName}: ${String(value).trim()}`);
						}
					}
				}
				if (formFields.length > 1) {
					text += formFields.join('\n');
				}
			}

			// Fallback: extract from page annotations if getFieldObjects didn't work
			if (!fieldObjects || Object.keys(fieldObjects).length === 0) {
				const formFields: string[] = ['\n\n--- FORM FIELD DATA ---'];
				for (let i = 1; i <= doc.numPages; i++) {
					const page = await doc.getPage(i);
					const annotations = await page.getAnnotations({ intent: 'display' });
					for (const annot of annotations) {
						if (annot.subtype === 'Widget' && annot.fieldValue) {
							const name = annot.fieldName || annot.alternativeText || `field_${annot.id}`;
							const value = String(annot.fieldValue).trim();
							if (value) {
								formFields.push(`${name}: ${value}`);
							}
						}
					}
				}
				if (formFields.length > 1) {
					text += formFields.join('\n');
				}
			}
		} catch (formErr) {
			console.warn('Could not extract form fields:', formErr);
			// Continue with just the text content
		}

		return json({
			text,
			pages: parsed.total,
			filename: file.name
		});
	} catch (error) {
		console.error('PDF parse error:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to parse PDF' },
			{ status: 500 }
		);
	}
};
