/**
 * API Client for 99 Wisdom Book
 * Handles all API communications with the Cloudflare D1 backend
 */

/* 독자 토큰 — 로그인을 대신하는 것.

   메일에 실려 온 링크에는 ?t=<토큰> 이 붙어 있다. 그 주소로 들어오면
   토큰을 이 기기에 넣어 두고, 이후 요청은 그것으로 신분을 밝힌다.
   비밀번호를 적는 화면은 없다.

   주소창에서는 지운다. 토큰이 붙은 주소가 그대로 남으면 공유나 북마크로
   남의 손에 넘어가고, 리퍼러로 밖에 나간다.

   authToken(관리자 세션)과는 따로 둔다. 관리자가 같은 기기에서 쓰더라도
   서로를 지우지 않아야 한다. */
const READER_KEY = 'readerToken';

function captureReaderToken() {
  try {
    const u = new URL(window.location.href);
    const t = (u.searchParams.get('t') || '').trim();
    /* 쓰기 토큰(id.만료.서명)과 설정 토큰(32자 16진수) 두 꼴만 받는다. */
    if (!/^\d+\.\d+\.[A-Za-z0-9_-]{20,}$/.test(t) && !/^[0-9a-f]{32}$/.test(t)) return;
    localStorage.setItem(READER_KEY, t);
    u.searchParams.delete('t');
    window.history.replaceState(null, '', u.pathname + (u.search || '') + (u.hash || ''));
  } catch (_) {}
}

class WisdomBookAPI {
  constructor(baseURL = '') {
    this.baseURL = baseURL || window.location.origin;
    captureReaderToken();
    this.token = this.getStoredToken();
  }

  /* 관리자 세션이 있으면 그것을 먼저 쓴다. 관리자 화면은 세션만 받는다. */
  getStoredToken() {
    return localStorage.getItem('authToken')
      || sessionStorage.getItem('authToken')
      || localStorage.getItem(READER_KEY);
  }

  get readerToken() {
    return localStorage.getItem(READER_KEY) || '';
  }

  clearReaderToken() {
    localStorage.removeItem(READER_KEY);
    localStorage.removeItem('me');
    if (this.token === localStorage.getItem(READER_KEY)) this.token = null;
  }

  /* 내가 누구인지 서버에 묻는다. 로그인 캐시(currentUser) 대신 쓴다.
     한 번 받아 두면 화면이 다시 열릴 때 깜빡이지 않는다. */
  async me(force) {
    if (!force) {
      try {
        const c = JSON.parse(localStorage.getItem('me') || 'null');
        if (c && c.at > Date.now() - 6 * 3600 * 1000) return c.user;
      } catch (_) {}
    }
    if (!this.token) return null;
    try {
      const d = await this.request('/api/me');
      if (d && d.success) {
        localStorage.setItem('me', JSON.stringify({ at: Date.now(), user: d.user }));
        return d.user;
      }
    } catch (_) {
      /* 토큰이 만료된 것이다. 붙잡고 있으면 매 요청이 401 이 된다. */
      this.clearReaderToken();
    }
    return null;
  }

  /** 글을 쓸 수 있는가 — 쓰기 토큰을 들고 있는가. */
  canWrite() {
    return /^\d+\.\d+\./.test(this.readerToken);
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

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`서버 연결에 실패했습니다. (${response.status})`);
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `오류가 발생했습니다. (${response.status})`);
      }

      return data;
    } catch (error) {
      console.error('API Request Error:', error);
      throw error;
    }
  }

  // Authentication Methods
  async login(email, password, rememberMe = false) {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
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

  async register(email, password, name) {
    const data = await this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
      skipAuth: true,
    });

    return data;
  }


  /* 토큰은 서버 sessions 테이블에 있는 세션이므로, 로컬만 지우면
     그 세션이 만료(90일)까지 살아남는다. 서버에도 폐기를 알린다. */
  async logout() {
    const token = this.token;
    this.clearToken();
    this.clearReaderToken();
    localStorage.removeItem('currentUser');
    sessionStorage.removeItem('currentUser');
    if (!token) return;
    try {
      await fetch(`${this.baseURL}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
    } catch (_) {}
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

  /* 들어와 있는가. 독자는 토큰만 있으면 들어와 있는 것이다(로그인 없음).
     관리자는 예전처럼 세션과 캐시가 둘 다 있어야 한다. */
  isLoggedIn() {
    if (this.readerToken) return true;
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
