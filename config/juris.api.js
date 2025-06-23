// Fixed API configuration - replace your current api.endpoints section

module.exports = {
	features: {
		ssr: true,
		api: true,
		compression: false,
		staticServing: false
	},

	api: {
		prefix: '/api',
		cors: { enabled: true },
		rateLimit: { enabled: false },

		// Fixed API endpoints
		endpoints: {
			'/users': {
				method: 'GET',
				handler: async (request, reply) => {
					console.log('API: GET /users called');

					try {
						// Mock users data
						const users = [
							{ id: 1, name: 'John Doe', email: 'john@example.com', status: 'active' },
							{ id: 2, name: 'Jane Smith', email: 'jane@example.com', status: 'active' },
							{ id: 3, name: 'Bob Johnson', email: 'bob@example.com', status: 'inactive' },
							{ id: 4, name: 'Alice Brown', email: 'alice@example.com', status: 'active' }
						];

						// Handle query parameters
						const { status, search } = request.query || {};

						let filteredUsers = users;

						if (status) {
							filteredUsers = filteredUsers.filter(user => user.status === status);
						}

						if (search) {
							filteredUsers = filteredUsers.filter(user =>
								user.name.toLowerCase().includes(search.toLowerCase()) ||
								user.email.toLowerCase().includes(search.toLowerCase())
							);
						}

						// Set proper content type and return JSON
						reply.type('application/json');
						return filteredUsers; // Return array directly, not wrapped in object
					} catch (error) {
						console.error('Error in /users endpoint:', error);
						reply.code(500);
						return { error: 'Internal server error' };
					}
				}
			}
		}
	}
};