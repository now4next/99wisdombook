# 🚀 Quick Reference Card - D1 Database Setup

## ⚡ 15-Minute Setup Checklist

### ☑️ Prerequisites (Already Done)
- ✅ Backend code created and pushed to GitHub
- ✅ Commit: `5b348eb`
- ✅ All files ready in repository

---

## 🎯 Do These 4 Steps Now:

### 1️⃣ Create D1 Database (3 min)
```
1. Go to: https://dash.cloudflare.com
2. Click: Workers & Pages → D1 SQL Database
3. Click: "Create database"
4. Name: wisdom-book-db
5. Click: "Create"
```

### 2️⃣ Initialize Schema (1 min)
```
1. In D1 database page, click "Console" tab
2. Open file: schema.sql
3. Copy ALL content
4. Paste in console
5. Click "Execute"
✅ See: "Query executed successfully"
```

### 3️⃣ Copy Database ID (1 min)
```
1. In D1 database page, copy the Database ID:
   Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   
2. Edit wrangler.toml:
   Find: database_id = "your-database-id-will-be-here"
   Replace with YOUR ID
   
3. Save, commit, push:
   git add wrangler.toml
   git commit -m "config: Add D1 database ID"
   git push origin main
```

### 4️⃣ Bind D1 to Pages (2 min)
```
1. Go to: Workers & Pages → 99wisdombook
2. Click: Settings → Functions
3. Find: "D1 database bindings"
4. Click: "Add binding"
5. Set:
   - Variable name: DB
   - D1 database: wisdom-book-db
6. Click: "Save"
```

---

## ✅ Test It Works (3 min)

### Test API Login:
```bash
curl -X POST https://99wisdombook.org/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

### Expected Response:
```json
{
  "success": true,
  "user": {
    "username": "admin",
    "role": "admin",
    ...
  },
  "token": "..."
}
```

✅ **If you see this, YOU'RE DONE!** The database is working! 🎉

---

## 📞 Quick Commands

### View users in D1 Console:
```sql
SELECT id, username, name, role, permissions FROM users;
```

### Add test user manually:
```sql
INSERT INTO users (username, password, name, role, permissions)
VALUES (
  'testuser',
  '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  'Test User',
  'user',
  '["korean"]'
);
```
Note: Password hash above is for "test" (SHA-256)

### Check database status:
```bash
# In Cloudflare Dashboard → D1 → Your Database → Console:
SELECT COUNT(*) as user_count FROM users;
```

---

## 🐛 Troubleshooting

### Problem: "Database not found"
**Fix:** Check wrangler.toml database_id matches your D1 database ID

### Problem: API returns 404
**Fix:** Check functions/api/[[path]].js is deployed. Wait 2 min after push.

### Problem: Can't see new users
**Fix:** Make sure D1 binding variable name is exactly "DB" (capital)

### Problem: Login doesn't work
**Fix:** 
```sql
-- Check admin exists:
SELECT * FROM users WHERE username = 'admin';

-- If missing, run schema.sql again
```

---

## 📚 Documentation Files

| File | Purpose | When to Use |
|------|---------|-------------|
| `SETUP_COMPLETE_BACKEND.md` | Complete overview | Read first |
| `CLOUDFLARE_D1_COMPLETE_GUIDE.md` | Detailed instructions | Step-by-step guide |
| `D1_SETUP_GUIDE.md` | D1-specific setup | Database setup |
| `ARCHITECTURE.md` | System diagrams | Understanding flow |
| `QUICK_REFERENCE.md` | This file | Quick lookup |

---

## 🎯 What You Get

After setup:
- ✅ Centralized user database
- ✅ Cross-device synchronization
- ✅ Real-time admin dashboard capability
- ✅ Professional authentication system
- ✅ Secure password storage
- ✅ RESTful API with 7 endpoints
- ✅ Automatic backups
- ✅ Global CDN distribution
- ✅ $0/month cost (free tier)

---

## 🔑 Default Credentials

**Admin Account:**
- Username: `admin`
- Password: `admin123`
- ⚠️ **CHANGE THIS IMMEDIATELY!**

**New Users:**
- Default permission: Korean only
- Admin can grant additional languages

---

## 📊 API Endpoints Summary

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/auth/login` | POST | No | Login user |
| `/api/auth/register` | POST | No | Register new user |
| `/api/users` | GET | Admin | List all users |
| `/api/users/:id` | GET | Admin | Get user details |
| `/api/users/:id` | PUT | Admin | Update user |
| `/api/users/:id` | DELETE | Admin | Delete user |
| `/api/users/:id/permissions` | PUT | Admin | Update permissions |

---

## 💡 Pro Tips

1. **Test in browser console:**
   ```javascript
   const api = new WisdomBookAPI();
   await api.login('admin', 'admin123');
   ```

2. **Monitor deployments:**
   - Dashboard → Workers & Pages → 99wisdombook → Deployments

3. **View logs:**
   - Dashboard → Workers & Pages → 99wisdombook → Analytics

4. **Backup database:**
   - D1 Console → Run: `SELECT * FROM users;` → Copy results

---

## 🎉 Success Indicators

You know it's working when:
- ✅ curl test returns user data
- ✅ No "database not found" errors
- ✅ Admin account can login
- ✅ New users can register
- ✅ Browser console tests work

---

## 📞 Need Help?

1. Check deployment logs in Cloudflare
2. Verify D1 database has users table
3. Test with curl commands above
4. Check browser console for errors
5. Review documentation files

---

**Total setup time: ~15 minutes**
**Current status: Backend ready, waiting for your D1 setup!**

🚀 **Let's go!** Follow the 4 steps above and your database will be live!
