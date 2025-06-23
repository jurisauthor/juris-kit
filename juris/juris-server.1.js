// juris/server.js - Core Juris Server Implementation (Fixed Logger)
const path = require('path');
const fs = require('fs');

class JurisServer {
	constructor(configPath = null) {
		this.configPath = configPath || this.findConfigFile();
		this.config = this.loadConfiguration();
		this.fastify = null;
		this.app = null;
		this.isInitialized = false;
		this.stringRenderer = null;
		this.router = null;
	}

	// Find configuration file in standard locations
	findConfigFile() {
		const possiblePaths = [
			path.join(process.cwd(), 'juris.config.js'),
			path.join(process.cwd(), 'config', 'juris.config.js'),
			path.join(process.cwd(), '.jurisrc.js')
		];

		for (const configPath of possiblePaths) {
			if (fs.existsSync(configPath)) {
				return configPath;
			}
		}

		// Use default config if none found
		console.warn('No juris.config.js found, using default configuration');
		return null;
	}

	// Load and merge configuration
	loadConfiguration() {
		const defaultConfig = this.getDefaultConfig();

		if (!this.configPath) {
			return defaultConfig;
		}

		try {
			// Clear require cache for hot reload in development
			if (process.env.NODE_ENV !== 'production') {
				delete require.cache[require.resolve(this.configPath)];
			}

			const userConfig = require(this.configPath);
			return this.deepMerge(defaultConfig, userConfig);
		} catch (error) {
			console.error('Error loading configuration:', error);
			return defaultConfig;
		}
	}

	// Default configuration
	getDefaultConfig() {
		return {
			server: {
				port: process.env.PORT || 3000,
				host: process.env.HOST || '0.0.0.0',
				fastify: {
					logger: false,  // Disable logging by default
					disableRequestLogging: true,
					keepAliveTimeout: 30000,
					connectionTimeout: 60000,
					bodyLimit: 1048576,
					maxParamLength: 100,
					ignoreTrailingSlash: true,
					caseSensitive: false
				},
				compression: {
					enabled: true,
					global: true,
					threshold: 1024,
					encodings: ['gzip', 'deflate']
				}
			},
			app: {
				title: 'Juris SSR App',
				initialState: {}
			},
			static: {
				public: {
					root: 'public',
					prefix: '/public/',
					cache: {
						maxAge: '1d',
						immutable: true,
						etag: true,
						lastModified: true
					}
				},
				directories: []
			},
			routes: {
				catchAll: true,
				custom: [],
				exclude: {
					patterns: [
						/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/,
						/^\/\.well-known\//
					]
				}
			},
			features: {
				ssr: true,
				compression: true,
				staticServing: true
			},
			hooks: {}
		};
	}

	// Deep merge utility
	deepMerge(target, source) {
		const output = Object.assign({}, target);
		if (isObject(target) && isObject(source)) {
			Object.keys(source).forEach(key => {
				if (isObject(source[key])) {
					if (!(key in target))
						Object.assign(output, { [key]: source[key] });
					else
						output[key] = this.deepMerge(target[key], source[key]);
				} else {
					Object.assign(output, { [key]: source[key] });
				}
			});
		}
		return output;

		function isObject(item) {
			return item && typeof item === 'object' && !Array.isArray(item);
		}
	}

	// Initialize server
	async initialize() {
		if (this.isInitialized) return;

		// Initialize mock DOM globals
		this.initializeDOMGlobals();

		// Process logger configuration for new Fastify versions
		const fastifyConfig = { ...this.config.server.fastify };

		// Handle logger configuration properly
		if (fastifyConfig.logger && typeof fastifyConfig.logger === 'object') {
			// Remove deprecated options
			delete fastifyConfig.logger.prettyPrint;

			// If pretty printing is desired in development, use pino-pretty
			if (process.env.NODE_ENV !== 'production' && fastifyConfig.logger.level) {
				// For development, you can use pino-pretty separately
				// but not as a fastify logger option
				console.log('Note: For pretty logging in development, use pino-pretty separately');
			}
		}

		// Create Fastify instance with cleaned config
		this.fastify = require('fastify')(fastifyConfig);

		// Apply compression if enabled
		if (this.config.features.compression && this.config.server.compression.enabled) {
			await this.setupCompression();
		}

		// Setup static file serving
		if (this.config.features.staticServing) {
			await this.setupStaticServing();
		}

		// Setup custom routes
		if (this.config.routes.custom && this.config.routes.custom.length > 0) {
			await this.setupCustomRoutes();
		}

		// Setup health check
		if (this.config.monitoring?.healthCheck?.enabled) {
			this.setupHealthCheck();
		}

		// Setup development routes
		if (process.env.NODE_ENV !== 'production' && this.config.development?.routes) {
			await this.setupDevelopmentRoutes();
		}

		// Load Juris app
		await this.loadJurisApp();

		// Setup SSR catch-all route
		if (this.config.features.ssr && this.config.routes.catchAll) {
			this.setupSSRRoute();
		}

		// Call initialization hook
		if (this.config.hooks?.beforeServerStart) {
			await this.config.hooks.beforeServerStart(this.fastify, this.config);
		}

		this.isInitialized = true;
	}

	// Initialize DOM globals for SSR
	initializeDOMGlobals() {
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
	}

	// Setup compression
	async setupCompression() {
		const compressionOptions = {
			...this.config.server.compression,
			enabled: undefined // Remove our custom property
		};

		await this.fastify.register(require('@fastify/compress'), compressionOptions);
	}

	// Setup static file serving
	async setupStaticServing() {
		const fastifyStatic = require('@fastify/static');

		// Setup public directory
		if (this.config.static.public) {
			const publicPath = path.join(process.cwd(), this.config.static.public.root);
			if (fs.existsSync(publicPath)) {
				await this.fastify.register(fastifyStatic, {
					root: publicPath,
					prefix: this.config.static.public.prefix,
					...this.config.static.public.cache
				});
			}
		}

		// Setup additional static directories
		for (const dir of this.config.static.directories || []) {
			const dirPath = path.join(process.cwd(), dir.root);
			if (fs.existsSync(dirPath)) {
				await this.fastify.register(fastifyStatic, {
					root: dirPath,
					prefix: dir.prefix,
					decorateReply: false,
					...(dir.cache || this.config.static.public.cache)
				});
			}
		}
	}

	// Setup custom routes
	async setupCustomRoutes() {
		for (const route of this.config.routes.custom) {
			this.fastify[route.method.toLowerCase()](route.path, route.options || {}, route.handler);
		}
	}

	// Setup health check endpoint
	setupHealthCheck() {
		const healthConfig = this.config.monitoring.healthCheck;

		this.fastify.get(healthConfig.path || '/health', async (request, reply) => {
			const health = {
				status: 'ok',
				timestamp: Date.now(),
				uptime: process.uptime()
			};

			if (healthConfig.detailed) {
				health.details = {
					memory: process.memoryUsage(),
					pid: process.pid,
					version: process.version,
					config: {
						port: this.config.server.port,
						environment: process.env.NODE_ENV || 'development'
					}
				};
			}

			return health;
		});
	}

	// Setup development routes
	async setupDevelopmentRoutes() {
		for (const route of this.config.development.routes) {
			if (route.handler.startsWith('serveFile:')) {
				const filePath = route.handler.replace('serveFile:', '');
				this.fastify.get(route.path, async (request, reply) => {
					reply.header('Cache-Control', 'no-cache');
					return reply.sendFile(filePath, path.join(process.cwd()));
				});
			} else if (typeof route.handler === 'function') {
				this.fastify[route.method.toLowerCase()](route.path, route.handler);
			}
		}
	}

	// Load Juris app
	async loadJurisApp() {
		try {
			// Try to load from the bundled app first
			const appPath = path.join(process.cwd(), 'public/js/juris-app.js');
			if (fs.existsSync(appPath)) {
				const { createApp } = require(appPath);
				this.app = createApp(this.config.app.initialState);
			} else {
				// Fallback to source
				const { createApp } = require(path.join(process.cwd(), 'source/app.js'));
				this.app = createApp(this.config.app.initialState);
			}

			// Enable string renderer
			this.stringRenderer = this.app.getHeadlessComponent('StringRenderer').api;
			this.stringRenderer.enableStringRenderer();
			this.router = this.app.getHeadlessComponent('Router').api;
		} catch (error) {
			console.error('Error loading Juris app:', error);
			throw error;
		}
	}

	// Setup SSR route
	setupSSRRoute() {
		// Pre-compile HTML template
		const htmlTemplate = this.createHTMLTemplate();

		// Route schema for performance
		const routeSchema = {
			response: {
				200: { type: 'string' },
				404: { type: 'string' },
				500: { type: 'string' }
			}
		};

		// SSR catch-all handler
		this.fastify.get('*', { schema: routeSchema }, async (request, reply) => {
			const url = request.url;

			// Check exclusion patterns
			for (const pattern of this.config.routes.exclude.patterns) {
				if (pattern.test(url)) {
					reply.code(404);
					return 'Not Found';
				}
			}

			try {
				// Reset app state for each requestfor performance
				this.resetAppForRequest();

				// Call before render hook
				if (this.config.hooks?.beforeRender) {
					await this.config.hooks.beforeRender(this.app, url, this.config);
				}

				// Get router and string renderer

				// Set route to tell Juris what to render
				this.router.setRoute(url);
				// Render the app to string based on the current route
				const content = this.stringRenderer.renderToString();
				// get the current state of the app for hydration
				// This will be used to hydrate the app on the client side
				const state = this.app.stateManager.state;

				// Get page-specific config
				const pageConfig = this.config.routes.pages?.[url] || {};
				const title = pageConfig.title || this.config.app.title;

				// Call after render hook
				let finalHTML = htmlTemplate(content, state, title);
				if (this.config.hooks?.afterRender) {
					const result = await this.config.hooks.afterRender(finalHTML, state, url, this.config);
					finalHTML = result.html || finalHTML;
				}

				// Set headers
				reply.type('text/html; charset=utf-8');

				if (process.env.NODE_ENV === 'production') {
					// Production caching
					if (this.config.production?.performance?.cache?.ssrCacheDuration) {
						reply.header('Cache-Control', `public, max-age=${this.config.production.performance.cache.ssrCacheDuration}`);
					} else {
						reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
					}

					// Security headers
					if (this.config.production?.security?.headers) {
						for (const [header, value] of Object.entries(this.config.production.security.headers)) {
							reply.header(header, value);
						}
					}
				} else {
					reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
				}

				return finalHTML;

			} catch (error) {
				console.error('SSR Error:', error);
				reply.code(500);

				if (this.config.production?.errorHandling?.customErrorPage && process.env.NODE_ENV === 'production') {
					return this.renderErrorPage(error);
				}

				const showStack = process.env.NODE_ENV !== 'production' || this.config.development?.errorHandling?.showStack;
				return `<h1>Server Error</h1><p>${error.message}</p>${showStack ? `<pre>${error.stack}</pre>` : ''}`;
			}
		});
	}

	// Reset app for request
	resetAppForRequest() {
		this.app.stateManager.reset([]);
		this.app.stateManager.state = { ...this.config.app.initialState };
	}

	// Create HTML template function
	createHTMLTemplate() {
		return (content, state, title) => {
			const meta = this.config.app.meta || {};
			const customMeta = meta.custom || [];

			return `<!DOCTYPE html>
<html lang="${this.config.app.lang || 'en'}">
<head>
    <meta charset="${meta.charset || 'UTF-8'}">
    <meta name="viewport" content="${meta.viewport || 'width=device-width, initial-scale=1.0'}">
    <title>${title}</title>
    ${customMeta.map(m => {
				if (m.name) return `<meta name="${m.name}" content="${m.content}">`;
				if (m.property) return `<meta property="${m.property}" content="${m.content}">`;
				return '';
			}).join('\n    ')}
    <link rel="stylesheet" href="/public/css/styles.css">
</head>
<body>
    <div id="app">${content}</div>
    <script>
        window.__hydration_data = ${JSON.stringify(state)};
    </script>
    <script src="/public/js/juris-app.js"></script>
</body>
</html>`;
		};
	}

	// Render error page
	renderErrorPage(error) {
		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Error - ${this.config.app.title}</title>
    <style>
        body { font-family: system-ui, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        h1 { color: #d32f2f; }
        .error-code { background: #f5f5f5; padding: 10px; border-radius: 4px; }
    </style>
</head>
<body>
    <h1>Something went wrong</h1>
    <p>We're sorry, but something went wrong on our end.</p>
    <p class="error-code">Error Code: ${Date.now()}</p>
</body>
</html>`;
	}

	// Start server
	async start() {
		try {
			await this.initialize();

			const listenOptions = {
				port: this.config.server.port,
				host: this.config.server.host,
				backlog: this.config.server.fastify.backlog || 1024,
				exclusive: this.config.server.fastify.exclusive || false
			};

			await this.fastify.listen(listenOptions);

			// Call after start hook
			if (this.config.hooks?.afterServerStart) {
				await this.config.hooks.afterServerStart(this.fastify, this.config);
			}

			console.log(`🚀 Juris Server running on http://${this.config.server.host}:${this.config.server.port}`);
			console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
			console.log(`Configuration: ${this.configPath || 'default'}`);

			if (process.env.NODE_ENV !== 'production') {
				console.log('\nEnabled features:');
				Object.entries(this.config.features).forEach(([feature, enabled]) => {
					if (enabled) console.log(`  ✓ ${feature}`);
				});

				console.log('\nAvailable routes:');
				this.config.routes.custom?.forEach(route => {
					console.log(`  ${route.method} ${route.path}`);
				});
				if (this.config.monitoring?.healthCheck?.enabled) {
					console.log(`  GET ${this.config.monitoring.healthCheck.path || '/health'} - Health check`);
				}
				if (this.config.routes.catchAll) {
					console.log('  GET * - SSR catch-all');
				}
			}

		} catch (err) {
			console.error('Failed to start server:', err);
			process.exit(1);
		}
	}

	// Stop server
	async stop() {
		if (this.fastify) {
			await this.fastify.close();
		}
	}

	// Reload configuration (for development)
	async reload() {
		console.log('Reloading configuration...');
		this.config = this.loadConfiguration();
		await this.stop();
		this.isInitialized = false;
		await this.start();
	}
}

// Export the server class
module.exports = JurisServer;