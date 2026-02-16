/**
 * Cloudflare Workers API for 99 Wisdom Book
 * Handles all user management operations with D1 database
 * 
 * API Endpoints:
 * - POST   /api/auth/login       - User login
 * - POST   /api/auth/register    - User registration
 * - GET    /api/users            - Get all users (admin only)
 * - GET    /api/users/:id        - Get user by ID
 * - PUT    /api/users/:id        - Update user
 * - DELETE /api/users/:id        - Delete user (admin only)
 * - PUT    /api/users/:id/permissions - Update user permissions (admin only)
 */

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Helper function to create JSON response
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

// Helper function to hash password (SHA-256)
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Verify admin token (simple implementation - you should use proper JWT in production)
function verifyAdmin(request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  const token = authHeader.substring(7);
  // In production, verify JWT token here
  // For now, we'll use a simple check
  return token && token.length > 10;
}

// Main request handler
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Handle OPTIONS for CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Route handling
    if (path === '/api/auth/login' && request.method === 'POST') {
      return await handleLogin(request, env);
    }
    
    if (path === '/api/auth/register' && request.method === 'POST') {
      return await handleRegister(request, env);
    }
    
    if (path === '/api/users' && request.method === 'GET') {
      return await handleGetUsers(request, env);
    }
    
    if (path.match(/^\/api\/users\/\d+$/) && request.method === 'GET') {
      const userId = path.split('/').pop();
      return await handleGetUser(userId, env);
    }
    
    if (path.match(/^\/api\/users\/\d+$/) && request.method === 'PUT') {
      const userId = path.split('/').pop();
      return await handleUpdateUser(userId, request, env);
    }
    
    if (path.match(/^\/api\/users\/\d+$/) && request.method === 'DELETE') {
      const userId = path.split('/').pop();
      return await handleDeleteUser(userId, request, env);
    }
    
    if (path.match(/^\/api\/users\/\d+\/permissions$/) && request.method === 'PUT') {
      const userId = path.split('/')[3];
      return await handleUpdatePermissions(userId, request, env);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  } catch (error) {
    console.error('API Error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

// Login handler
async function handleLogin(request, env) {
  const { username, password } = await request.json();
  
  if (!username || !password) {
    return jsonResponse({ error: 'Username and password required' }, 400);
  }

  const hashedPassword = await hashPassword(password);
  
  const result = await env.DB.prepare(
    'SELECT id, username, name, email, role, permissions, last_login FROM users WHERE username = ? AND password = ?'
  ).bind(username, hashedPassword).first();

  if (!result) {
    return jsonResponse({ error: 'Invalid credentials' }, 401);
  }

  // Update last login
  await env.DB.prepare(
    'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(result.id).run();

  // Parse permissions JSON
  const user = {
    ...result,
    permissions: JSON.parse(result.permissions || '[]'),
  };

  // Generate simple token (in production, use proper JWT)
  const token = btoa(`${user.id}:${Date.now()}`);

  return jsonResponse({
    success: true,
    user,
    token,
  });
}

// Register handler
async function handleRegister(request, env) {
  const { username, password, name, email } = await request.json();
  
  if (!username || !password || !name) {
    return jsonResponse({ error: 'Username, password, and name required' }, 400);
  }

  // Check if user exists
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE username = ?'
  ).bind(username).first();

  if (existing) {
    return jsonResponse({ error: 'Username already exists' }, 409);
  }

  const hashedPassword = await hashPassword(password);
  
  // Insert new user with default permissions (only Korean)
  const result = await env.DB.prepare(
    'INSERT INTO users (username, password, name, email, role, permissions) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, username, name, email, role, permissions, created_at'
  ).bind(username, hashedPassword, name, email || null, 'user', '["korean"]').first();

  if (!result) {
    return jsonResponse({ error: 'Failed to create user' }, 500);
  }

  const user = {
    ...result,
    permissions: JSON.parse(result.permissions || '[]'),
  };

  return jsonResponse({
    success: true,
    user,
    message: 'User registered successfully',
  }, 201);
}

// Get all users (admin only)
async function handleGetUsers(request, env) {
  if (!verifyAdmin(request)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const result = await env.DB.prepare(
    'SELECT id, username, name, email, role, permissions, created_at, last_login FROM users ORDER BY created_at DESC'
  ).all();

  const users = result.results.map(user => ({
    ...user,
    permissions: JSON.parse(user.permissions || '[]'),
  }));

  return jsonResponse({
    success: true,
    users,
    count: users.length,
  });
}

// Get single user
async function handleGetUser(userId, env) {
  const result = await env.DB.prepare(
    'SELECT id, username, name, email, role, permissions, created_at, last_login FROM users WHERE id = ?'
  ).bind(userId).first();

  if (!result) {
    return jsonResponse({ error: 'User not found' }, 404);
  }

  const user = {
    ...result,
    permissions: JSON.parse(result.permissions || '[]'),
  };

  return jsonResponse({
    success: true,
    user,
  });
}

// Update user
async function handleUpdateUser(userId, request, env) {
  if (!verifyAdmin(request)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const { name, email, role, permissions } = await request.json();
  
  const updates = [];
  const bindings = [];

  if (name) {
    updates.push('name = ?');
    bindings.push(name);
  }
  if (email !== undefined) {
    updates.push('email = ?');
    bindings.push(email);
  }
  if (role && (role === 'user' || role === 'admin')) {
    updates.push('role = ?');
    bindings.push(role);
  }
  if (permissions && Array.isArray(permissions)) {
    // Validate permissions
    const validPermissions = ['korean', 'english', 'chinese', 'japanese', 'spanish', 'french', 'arabic', 'russian', 'hindi'];
    const invalidPerms = permissions.filter(p => !validPermissions.includes(p));
    
    if (invalidPerms.length > 0) {
      return jsonResponse({ 
        error: `Invalid permissions: ${invalidPerms.join(', ')}` 
      }, 400);
    }
    
    updates.push('permissions = ?');
    bindings.push(JSON.stringify(permissions));
  }

  if (updates.length === 0) {
    return jsonResponse({ error: 'No fields to update' }, 400);
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  bindings.push(userId);

  const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
  await env.DB.prepare(query).bind(...bindings).run();

  // Get updated user
  const result = await env.DB.prepare(
    'SELECT id, username, name, email, role, permissions, updated_at FROM users WHERE id = ?'
  ).bind(userId).first();

  const user = {
    ...result,
    permissions: JSON.parse(result.permissions || '[]'),
  };

  return jsonResponse({
    success: true,
    user,
    message: 'User updated successfully',
  });
}

// Delete user (admin only)
async function handleDeleteUser(userId, request, env) {
  if (!verifyAdmin(request)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  // Prevent deleting admin user
  const user = await env.DB.prepare(
    'SELECT role FROM users WHERE id = ?'
  ).bind(userId).first();

  if (!user) {
    return jsonResponse({ error: 'User not found' }, 404);
  }

  if (user.role === 'admin') {
    return jsonResponse({ error: 'Cannot delete admin user' }, 403);
  }

  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();

  return jsonResponse({
    success: true,
    message: 'User deleted successfully',
  });
}

// Update user permissions (admin only)
async function handleUpdatePermissions(userId, request, env) {
  if (!verifyAdmin(request)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const { permissions } = await request.json();
  
  if (!Array.isArray(permissions)) {
    return jsonResponse({ error: 'Permissions must be an array' }, 400);
  }

  const validPermissions = ['korean', 'english', 'chinese', 'japanese', 'spanish', 'french', 'arabic', 'russian', 'hindi'];
  const invalidPerms = permissions.filter(p => !validPermissions.includes(p));
  
  if (invalidPerms.length > 0) {
    return jsonResponse({ 
      error: `Invalid permissions: ${invalidPerms.join(', ')}` 
    }, 400);
  }

  await env.DB.prepare(
    'UPDATE users SET permissions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(JSON.stringify(permissions), userId).run();

  // Get updated user
  const result = await env.DB.prepare(
    'SELECT id, username, name, role, permissions, updated_at FROM users WHERE id = ?'
  ).bind(userId).first();

  const user = {
    ...result,
    permissions: JSON.parse(result.permissions || '[]'),
  };

  return jsonResponse({
    success: true,
    user,
    message: 'Permissions updated successfully',
  });
}
