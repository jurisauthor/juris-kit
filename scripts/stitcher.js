#!/usr/bin/env node

/**
 * JurisKit JavaScript File Stitcher
 * 
 * A powerful Node.js utility that combines multiple JavaScript files into a single bundle.
 * Supports advanced file patterns, folder configurations, and intelligent file processing.
 * 
 * Features:
 * - Folder-level configuration with recursive scanning
 * - File exclusion patterns (strings and RegExp)
 * - Optional minification
 * - Automatic directory creation
 * - File separator comments for debugging
 * - Watch-friendly for development workflows
 * 
 * Usage:
 *   node scripts/stitcher.js [options]
 * 
 * Options:
 *   --config <path>    Path to config file (default: config/stitcher.config.json)
 *   --manual          Force manual execution mode (show progress logs)
 *   --init            Create a sample configuration file
 *   --help, -h        Show detailed help information
 * 
 * Configuration Example:
 *   {
 *     "output": "public/js/bundle.js",
 *     "files": [
 *       "juris/juris.js",
 *       "source/app.js",
 *       {
 *         "folder": "src/components",
 *         "recursive": true,
 *         "extensions": [".js", ".mjs"],
 *         "exclude": ["test", ".spec.", /\.min\./],
 *         "sort": true
 *       }
 *     ],
 *     "minify": false,
 *     "addSeparators": true,
 *     "skipMissing": false,
 *     "header": "Custom bundle header"
 *   }
 * 
 * @author JurisKit Team
 * @version 2.0.0
 * @license MIT
 */

const fs = require('fs').promises;
const path = require('path');
const { glob } = require('glob');

class JSStitcher {
	constructor(configPath = 'config/stitcher.config.json') {
		this.configPath = configPath;
		this.config = null;
		this.isManualExecution = process.argv.includes('--manual') || !process.env.npm_lifecycle_event;
	}

	/**
	 * Load and validate configuration file
	 */
	async loadConfig() {
		try {
			const configContent = await fs.readFile(this.configPath, 'utf8');
			this.config = JSON.parse(configContent);

			// Validate required fields
			if (!this.config.output) {
				throw new Error('Output path is required in config');
			}
			if (!this.config.files || !Array.isArray(this.config.files)) {
				throw new Error('Files array is required in config');
			}

			return this.config;
		} catch (error) {
			if (error.code === 'ENOENT') {
				throw new Error(`Config file not found: ${this.configPath}`);
			}
			throw error;
		}
	}

	/**
	 * Log message only during manual execution
	 */
	log(message) {
		if (this.isManualExecution) {
			console.log(message);
		}
	}

	/**
	 * Ensure output directory exists
	 */
	async ensureDirectoryExists(filePath) {
		const dir = path.dirname(filePath);
		try {
			await fs.access(dir);
		} catch {
			await fs.mkdir(dir, { recursive: true });
			this.log(`Created directory: ${dir}`);
		}
	}

	/**
	 * Read a single file with error handling
	 */
	async readFile(filePath) {
		try {
			const content = await fs.readFile(filePath, 'utf8');
			this.log(`✓ Read: ${filePath}`);
			return content;
		} catch (error) {
			if (error.code === 'ENOENT') {
				throw new Error(`File not found: ${filePath}`);
			}
			throw new Error(`Error reading ${filePath}: ${error.message}`);
		}
	}

	/**
	 * Expand file patterns and folder configurations into file list
	 */
	async expandFilePatterns(patterns) {
		const expandedFiles = [];

		for (const pattern of patterns) {
			if (typeof pattern === 'string') {
				// Handle glob patterns and folder paths
				if (pattern.includes('*') || pattern.includes('?')) {
					// Glob pattern
					const matches = await glob(pattern, { nodir: true });
					expandedFiles.push(...matches.sort());
				} else {
					// Check if it's a directory
					try {
						const stats = await fs.stat(pattern);
						if (stats.isDirectory()) {
							// Get all .js files in directory
							const dirPattern = path.join(pattern, '**/*.js');
							const matches = await glob(dirPattern, { nodir: true });
							expandedFiles.push(...matches.sort());
						} else {
							// It's a file
							expandedFiles.push(pattern);
						}
					} catch (error) {
						// File doesn't exist, add as-is (will be handled later)
						expandedFiles.push(pattern);
					}
				}
			} else if (typeof pattern === 'object') {
				// Handle folder config objects
				if (pattern.folder) {
					const folderFiles = await this.expandFolderConfig(pattern);
					expandedFiles.push(...folderFiles);
				} else if (pattern.files) {
					// Handle nested file arrays
					const nested = await this.expandFilePatterns(pattern.files);
					expandedFiles.push(...nested);
				}
			}
		}

		return expandedFiles;
	}

	/**
	 * Expand folder configuration object
	 */
	async expandFolderConfig(folderConfig) {
		const folderPath = folderConfig.folder;
		const options = {
			recursive: folderConfig.recursive !== false, // default true
			extensions: folderConfig.extensions || ['.js'],
			exclude: folderConfig.exclude || [],
			sort: folderConfig.sort !== false // default true
		};

		let searchPattern;
		if (options.recursive) {
			searchPattern = path.join(folderPath, '**/*');
		} else {
			searchPattern = path.join(folderPath, '*');
		}

		const matches = await glob(searchPattern, { nodir: true });

		// Filter by extensions and exclusions
		const filtered = matches.filter(file => {
			const ext = path.extname(file);
			const fileName = path.basename(file);
			const relativePath = path.relative(folderPath, file);

			// Check extension
			if (!options.extensions.includes(ext)) return false;

			// Check exclusions
			for (const exclude of options.exclude) {
				if (typeof exclude === 'string') {
					if (fileName.includes(exclude) || relativePath.includes(exclude)) {
						return false;
					}
				} else if (exclude instanceof RegExp) {
					if (exclude.test(fileName) || exclude.test(relativePath)) {
						return false;
					}
				}
			}

			return true;
		});

		if (options.sort) {
			filtered.sort();
		}

		return filtered;
	}

	/**
	 * Simple JavaScript minification
	 */
	minifyJS(code) {
		try {
			return code
				// Remove single-line comments
				.replace(/\/\/.*$/gm, '')
				// Remove multi-line comments
				.replace(/\/\*[\s\S]*?\*\//g, '')
				// Remove extra whitespace
				.replace(/\s+/g, ' ')
				// Remove whitespace around operators and punctuation
				.replace(/\s*([{}();,=+\-*/<>!&|])\s*/g, '$1')
				// Remove leading/trailing whitespace
				.trim();
		} catch (error) {
			throw new Error(`Minification failed: ${error.message}`);
		}
	}

	/**
	 * Main stitching process
	 */
	async stitchFiles() {
		await this.loadConfig();

		this.log(`Starting JS stitching with config: ${this.configPath}`);
		this.log(`Output: ${this.config.output}`);

		// Expand file patterns and folders
		const expandedFiles = await this.expandFilePatterns(this.config.files);

		this.log(`Files to process: ${expandedFiles.length}`);

		if (this.isManualExecution && expandedFiles.length > 10) {
			this.log(`First 10 files: ${expandedFiles.slice(0, 10).map(f => path.basename(f)).join(', ')}...`);
		} else if (this.isManualExecution) {
			this.log(`Files: ${expandedFiles.map(f => path.basename(f)).join(', ')}`);
		}

		// Ensure output directory exists
		await this.ensureDirectoryExists(this.config.output);

		const stitchedContent = [];

		// Add header comment if specified
		if (this.config.header) {
			stitchedContent.push(`/* ${this.config.header} */`);
			stitchedContent.push('');
		}

		// Process each file in order
		for (let i = 0; i < expandedFiles.length; i++) {
			const filePath = expandedFiles[i];

			try {
				// Add file separator comment
				if (this.config.addSeparators !== false) {
					stitchedContent.push(`/* === ${path.basename(filePath)} === */`);
				}

				const content = await this.readFile(filePath);
				stitchedContent.push(content);

				// Add newline between files
				if (i < expandedFiles.length - 1) {
					stitchedContent.push('');
				}

			} catch (error) {
				if (this.config.skipMissing) {
					this.log(`⚠ Skipping missing file: ${filePath}`);
					continue;
				}
				throw error;
			}
		}

		let finalContent = stitchedContent.join('\n');

		// Minify if requested
		if (this.config.minify) {
			this.log('Minifying output...');
			finalContent = this.minifyJS(finalContent);
		}

		// Write the stitched file
		await fs.writeFile(this.config.output, finalContent, 'utf8');

		const stats = await fs.stat(this.config.output);
		this.log(`✓ Successfully stitched ${expandedFiles.length} files`);
		this.log(`✓ Output written to: ${this.config.output} (${(stats.size / 1024).toFixed(2)} KB)`);

		return this.config.output;
	}

	/**
	 * Create a sample configuration file
	 */
	static async createSampleConfig() {
		const sampleConfig = {
			"output": "public/js/juris-app.js",
			"files": [
				"juris/juris.js",
				"source/app.js"
			],
			"minify": false,
			"addSeparators": true,
			"skipMissing": false,
			"header": "Juris App Bundle - Auto-generated"
		};

		// Ensure config directory exists
		try {
			await fs.mkdir('config', { recursive: true });
		} catch (error) {
			// Directory might already exist
		}

		await fs.writeFile('config/stitcher.config.json', JSON.stringify(sampleConfig, null, 2));
		console.log('✓ Created sample config: config/stitcher.config.json');
	}
}

/**
 * CLI handling
 */
async function main() {
	const args = process.argv.slice(2);

	if (args.includes('--help') || args.includes('-h')) {
		console.log(`
JavaScript File Stitcher

Usage:
  node scripts/stitcher.js [options]

Options:
  --config <path>    Path to config file (default: config/stitcher.config.json)
  --manual          Force manual execution mode (show progress)
  --init            Create a sample config file
  --help, -h        Show this help

Config file format:
{
  "output": "public/js/juris-app.js",
  "files": [
    "juris/juris.js",
    "source/app.js",
    "source/folder/**/*.js",
    {
      "folder": "source/modules",
      "recursive": true,
      "extensions": [".js", ".mjs"],
      "exclude": ["test", ".spec."],
      "sort": true
    }
  ],
  "minify": false,
  "addSeparators": true,
  "skipMissing": false,
  "header": "Optional header comment"
}
    `);
		return;
	}

	if (args.includes('--init')) {
		await JSStitcher.createSampleConfig();
		return;
	}

	const configIndex = args.indexOf('--config');
	const configPath = configIndex !== -1 ? args[configIndex + 1] : 'config/stitcher.config.json';

	try {
		const stitcher = new JSStitcher(configPath);
		await stitcher.stitchFiles();
	} catch (error) {
		console.error(`Error: ${error.message}`);
		process.exit(1);
	}
}

// Export for programmatic use
module.exports = JSStitcher;

// Run if called directly
if (require.main === module) {
	main().catch(error => {
		console.error(`Fatal error: ${error.message}`);
		process.exit(1);
	});
}