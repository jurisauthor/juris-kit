// server.js - Optimized Fastify Server for Juris SSR with Singleton
const fastify = require('fastify')({
	logger: false, // Disable logging for performance
	disableRequestLogging: true,
	keepAliveTimeout: 30000, // Increased from 5000
	connectionTimeout: 60000, // Increased from 10000
	bodyLimit: 1048576, // 1MB limit
	maxParamLength: 100,
	ignoreTrailingSlash: true,
	caseSensitive: false
});
const path = require('path');

// Mock DOM globals for server-side rendering (moved to top for better caching)
if (!global.document) {
	global.document = {
		createElement: () => ({}),
		querySelector: () => null,
		querySelectorAll: () => [],
		addEventListener: () => { }
	};
}

if (!global.window) {
	global.window = {
		addEventListener: () => { },
		history: null,
		location: { pathname: '/', search: '' }
	};
}

// Load Juris and app once
const Juris = require('./juris/juris.js');
const { createApp } = require('./source/app.js');

const PORT = process.env.PORT || 3000;

// Pre-compile HTML template parts for better performance
const HTML_HEAD = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Juris SSR App</title>
    <style>
        
    </style>
    <link rel="stylesheet" href="/public/css/styles.css">
</head>
<body>
    <div id="app">`;
const HTML_TAIL = `</div>    
    <script>
        // Hydration data
        window.__hydration_data = `;
const HTML_FOOTER = `;
    </script>    
    <!-- Include Juris and your app -->
    <script src="/public/js/juris-app.js"></script>    
</body>
</html>`;

// Optimized static file serving with caching
const staticOptions = {
	maxAge: '1d', // Cache static files for 1 day
	immutable: true,
	etag: true,
	lastModified: true
};

// Register static plugins with optimizations
fastify.register(require('@fastify/static'), {
	root: path.join(__dirname, 'public'),
	prefix: '/public/',
	...staticOptions
});

fastify.register(require('@fastify/static'), {
	root: path.join(__dirname, 'assets'),
	prefix: '/assets/',
	decorateReply: false,
	...staticOptions
});

fastify.register(require('@fastify/static'), {
	root: path.join(__dirname, 'css'),
	prefix: '/css/',
	decorateReply: false,
	...staticOptions
});

fastify.register(require('@fastify/static'), {
	root: path.join(__dirname, 'js'),
	prefix: '/js/',
	decorateReply: false,
	...staticOptions
});

fastify.register(require('@fastify/static'), {
	root: path.join(__dirname, 'images'),
	prefix: '/images/',
	decorateReply: false,
	...staticOptions
});

// Optimized development file serving
if (process.env.NODE_ENV !== 'production') {
	const jsPath = path.join(__dirname, 'js');

	fastify.get('/app.js', {
		schema: {
			response: {
				200: { type: 'string' }
			}
		}
	}, async (request, reply) => {
		reply.header('Cache-Control', 'no-cache');
		return reply.sendFile('app.js', jsPath);
	});

	fastify.get('/juris.js', {
		schema: {
			response: {
				200: { type: 'string' }
			}
		}
	}, async (request, reply) => {
		reply.header('Cache-Control', 'no-cache');
		return reply.sendFile('juris.js', jsPath);
	});
}

// Create singleton app instance
const app = createApp();
const stringRenderer = app.getHeadlessComponent('StringRenderer').api;
stringRenderer.enableStringRenderer();

// Pre-defined initial state for better performance
const INITIAL_STATE = {
	counter: 42,
	todos: [
		{ id: 1, text: 'Server-rendered todo1', done: false },
		{ id: 2, text: 'Another todo', done: true }
	],
	user: { name: 'Server User', isLoggedIn: true }
};

// Optimized app reset function
function resetAppForRequest() {
	app.stateManager.reset([]);
	app.stateManager.state = INITIAL_STATE;
	return app;
}

// Optimized HTML template function
function htmlTemplate(content, state) {
	return HTML_HEAD + content + HTML_TAIL + JSON.stringify(state) + HTML_FOOTER;
}

// Route schema for better performance
const routeSchema = {
	response: {
		200: { type: 'string' },
		404: { type: 'string' },
		500: { type: 'string' }
	}
};

// Pre-compile regex for better performance
const STATIC_FILE_REGEX = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/;
const WELL_KNOWN_REGEX = /^\/\.well-known\//;

// Optimized catch-all route handler
fastify.get('*', { schema: routeSchema }, async (request, reply) => {
	const url = request.url;

	// Fast path for static files and well-known URLs
	if (STATIC_FILE_REGEX.test(url) || WELL_KNOWN_REGEX.test(url)) {
		reply.code(404);
		return 'Not Found';
	}

	try {
		// Reset singleton app for this request
		const serverApp = resetAppForRequest();
		// Get router and string renderer (cached references)
		const router = serverApp.getHeadlessComponent('Router').api;
		const stringRenderer = serverApp.getHeadlessComponent('StringRenderer').api;
		// Enable string rendering and set route
		stringRenderer.enableStringRenderer();
		router.setRoute(url);
		// Render to string
		const content = stringRenderer.renderToString();
		console.log(content);
		// Get current state for hydration
		const state = serverApp.stateManager.state;
		// Set content type and send optimized HTML
		reply.type('text/html; charset=utf-8');
		reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');

		return htmlTemplate(content, state);

	} catch (error) {
		console.error('SSR Error:', error);
		reply.code(500);
		return `<h1>Server Error</h1><p>${error.message}</p>`;
	}
});

// Add compression for better performance
fastify.register(require('@fastify/compress'), {
	global: true,
	threshold: 1024, // Only compress responses > 1KB
	encodings: ['gzip', 'deflate']
});

// Optimize server startup
const start = async () => {
	try {
		// Use more optimized listen options
		await fastify.listen({
			port: PORT,
			host: '0.0.0.0',
			backlog: 1024, // Increase backlog
			exclusive: false
		});

		console.log(`🚀 Optimized Fastify Server running on http://localhost:${PORT}`);
		console.log('Performance optimizations enabled:');
		console.log('  ✓ Logging disabled');
		console.log('  ✓ Static file caching (1 day)');
		console.log('  ✓ Response compression (gzip/deflate)');
		console.log('  ✓ Pre-compiled HTML templates');
		console.log('  ✓ Optimized route schemas');
		console.log('  ✓ Increased connection limits');

		console.log('\nAvailable routes:');
		console.log('  GET /         - Home page');
		console.log('  GET /about    - About page');
		console.log('  GET /todos    - Todos page');
		console.log('  GET /user/:id - User profile');
	} catch (err) {
		fastify.log.error(err);
		process.exit(1);
	}
};

start();

module.exports = fastify;