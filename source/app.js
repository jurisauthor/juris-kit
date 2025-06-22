// source/app.js - Simplified with external components
(function () {
	'use strict';
	// Get Juris from appropriate source depending on environment
	let Juris;
	if (typeof window !== 'undefined' && window.Juris) {
		// Browser environment - use global Juris from stitched bundle
		Juris = window.Juris;
	} else if (typeof module !== 'undefined' && module.exports) {
		// Node.js environment - require Juris module
		Juris = require('../juris/juris.js');
	} else {
		throw new Error('Juris not available in this environment');
	}
	
	// Factory function to create app instances
	function createApp(initialState = {}) {
		return new Juris({
			states: {
				counter: 0,
				todos: [],
				user: { name: 'Guest', isLoggedIn: false },
				...initialState
			},
			headlessComponents: {
				StringRenderer: {
					fn: StringRendererComponent,
					options: { autoInit: true }
				},
				Router: {
					fn: SimpleRouter,
					options: {
						preserveOnRoute: ['user'],
						autoInit: true
					}
				}
			},
			components: {
				App,
				HomePage,
				TodosPage,
				UserPage,
				AboutPage,
				MultiStateRenderer,
				Router,
				Nav,
				SimpleRouter
			},

			layout: {
				div: {
					children: () => [{ App: {} }]
				}
			}
		});
	}

	// Client-side initialization - completely private
	if (typeof window !== 'undefined' && window.__hydration_data) {
		const startTime = performance.now();
		// Create isolated app instance for client
		const clientApp = createApp(window.__hydration_data);

		// Render immediately
		clientApp.render('#app');

		// Clean up hydration data
		delete window.__hydration_data;
		const endTime = performance.now();
		const totalMs = Math.round(endTime - startTime);
		clientApp.setState('matrics.renderedTime', totalMs);
		console.log('Client app hydrated securely');
	}

	// Server-side exports only
	if (typeof module !== 'undefined') {
		module.exports = { createApp };
	}

	// Only expose createApp factory for server hydration
	if (typeof window !== 'undefined') {
		window.createApp = createApp;
	}

})();