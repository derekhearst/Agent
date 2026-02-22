/**
 * Lightweight toast notification utility using DaisyUI toast classes.
 * Drop-in replacement for `Pop` from simplesvelte.
 */

function injectStyles() {
	if (document.getElementById('pop-toast-styles')) return;
	const style = document.createElement('style');
	style.id = 'pop-toast-styles';
	style.textContent = `
		@keyframes pop-slide-in {
			from { transform: translateX(100%); opacity: 0; }
			to { transform: translateX(0); opacity: 1; }
		}
		.pop-slide-in { animation: pop-slide-in 250ms ease-out; }
	`;
	document.head.appendChild(style);
}

function showToast(message: string, type: 'success' | 'error' | 'info' = 'info', duration = 3000) {
	injectStyles();
	const container = document.getElementById('pop-toast-container') ?? createContainer();
	const toast = document.createElement('div');
	toast.className = `alert alert-${type} shadow-lg pop-slide-in`;
	toast.textContent = message;
	container.appendChild(toast);
	setTimeout(() => {
		toast.style.opacity = '0';
		toast.style.transition = 'opacity 300ms';
		setTimeout(() => toast.remove(), 300);
	}, duration);
}

function createContainer(): HTMLDivElement {
	const el = document.createElement('div');
	el.id = 'pop-toast-container';
	el.className = 'toast toast-end toast-top z-[9999]';
	document.body.appendChild(el);
	return el;
}

export const Pop = {
	success(msg: string) {
		showToast(msg, 'success');
	},
	error(msg: string) {
		showToast(msg, 'error', 5000);
	},
	info(msg: string) {
		showToast(msg, 'info');
	},
	async confirm(msg: string): Promise<boolean> {
		return window.confirm(msg);
	}
};
