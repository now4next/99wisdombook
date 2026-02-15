/**
 * API Client for 99 Wisdom Book
 * Handles all API communications with the Cloudflare D1 backend
 */

class WisdomBookAPI {
  constructor(baseURL = '') {
    this.baseURL = baseURL || window.location.origin;
    this.token = this.getStoredToken();
  }

  // Get stored authentication token
  getStoredToken() {
    return localStorage.getItem('authToken') || sessionStorage.getItem('authToken');
  }

  // Store authentication token
  setToken(token, rememberMe = false) {
    this.token = token;
    if (rememberMe) {
      localStorage.setItem('authToken', token);
    } else {
      sessionStorage.setItem('authToken', token);
    }
  }

  // Clear authentication token
  clearToken() {
    this.token = null;
    localStorage.removeItem('authToken');
    sessionStorage.removeItem('authToken');
  }

  // Make API request with error handling
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Add authorization header if token exists
    if (this.token && !options.skipAuth) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return data;
    } catch (error) {
      console.error('API Request Error:', error);
      throw error;
    }
  }

  // Authentication Methods
  async login(username, password, rememberMe = false) {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      skipAuth: true,
    });

    if (data.success && data.token) {
      this.setToken(data.token, rememberMe);
      
      // Store user data for quick access (with API flag)
      const userData = { ...data.user, _fromAPI: true };
      if (rememberMe) {
        localStorage.setItem('currentUser', JSON.stringify(userData));
      } else {
        sessionStorage.setItem('currentUser', JSON.stringify(userData));
      }
    }

    return data;
  }

  async register(username, password, name, email) {
    const data = await this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, name, email }),
      skipAuth: true,
    });

    return data;
  }

  logout() {
    this.clearToken();
    localStorage.removeItem('currentUser');
    sessionStorage.removeItem('currentUser');
  }

  // User Management Methods (Admin)
  async getUsers() {
    return await this.request('/api/users', {
      method: 'GET',
    });
  }

  async getUser(userId) {
    return await this.request(`/api/users/${userId}`, {
      method: 'GET',
    });
  }

  async updateUser(userId, updates) {
    return await this.request(`/api/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteUser(userId) {
    return await this.request(`/api/users/${userId}`, {
      method: 'DELETE',
    });
  }

  async updatePermissions(userId, permissions) {
    return await this.request(`/api/users/${userId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    });
  }

  // Helper: Get current user from cache
  getCurrentUser() {
    const userStr = localStorage.getItem('currentUser') || sessionStorage.getItem('currentUser');
    if (!userStr) return null;
    
    try {
      return JSON.parse(userStr);
    } catch {
      return null;
    }
  }

  // Helper: Check if user is logged in
  isLoggedIn() {
    return !!this.token && !!this.getCurrentUser();
  }

  // Helper: Check if current user is admin
  isAdmin() {
    const user = this.getCurrentUser();
    return user && user.role === 'admin';
  }
}

// Create global API instance
window.wisdomAPI = new WisdomBookAPI();
