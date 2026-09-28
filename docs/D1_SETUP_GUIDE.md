# Cloudflare D1 Database Setup Guide

## 🎯 Overview
This guide will help you set up a centralized database for the 99 Wisdom Book using Cloudflare D1 and Workers.

## 📋 Prerequisites
- Cloudflare account with Pages project already deployed
- Wrangler CLI installed (or we'll use Cloudflare Dashboard)

---

## 🚀 Step 1: Create D1 Database

### Option A: Using Cloudflare Dashboard (Recommended)

1. **Go to Cloudflare Dashboard**
   - Navigate to https://dash.cloudflare.com
   - Select your account
   - Go to **Workers & Pages** → **D1 SQL Database**

2. **Create New Database**
   - Click **"Create database"**
   - Database name: `wisdom-book-db`
   - Click **"Create"**

3. **Copy Database ID**
   - After creation, you'll see the Database ID
   - Copy this ID (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

4. **Initialize Schema**
   - In the D1 database page, click **"Console"** tab
   - Copy and paste the entire content from `schema.sql`
   - Click **"Execute"**
   - Verify: You should see "Query executed successfully" message

### Option B: Using Wrangler CLI

```bash
# Login to Cloudflare
npx wrangler login

# Create database
npx wrangler d1 create wisdom-book-db

# Copy the database_id from output

# Initialize schema
npx wrangler d1 execute wisdom-book-db --file=./schema.sql
```

---

## 🔧 Step 2: Update Wrangler Configuration

1. **Edit `wrangler.toml`**
   - Open the file
   - Find the line: `database_id = "your-database-id-will-be-here"`
   - Replace with your actual Database ID from Step 1

   Example:
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "wisdom-book-db"
   database_id = "12345678-1234-1234-1234-123456789abc"
   ```

2. **Save the file**

---

## 📤 Step 3: Deploy to Cloudflare Pages

### Option A: Using Cloudflare Dashboard

1. **Bind D1 to Pages Project**
   - Go to **Workers & Pages**
   - Select your project: `99wisdombook`
   - Go to **Settings** → **Functions**
   - Scroll to **D1 database bindings**
   - Click **"Add binding"**
     - Variable name: `DB`
     - D1 database: Select `wisdom-book-db`
   - Click **"Save"**

2. **Deploy Updated Code**
   ```bash
   # Commit and push changes
   git add .
   git commit -m "feat: Add D1 database and API endpoints"
   git push origin main
   ```

3. **Verify Deployment**
   - Wait for automatic deployment to complete
   - Check deployment status in Cloudflare Dashboard

### Option B: Using Wrangler CLI

```bash
# Deploy to Cloudflare Pages
npx wrangler pages deploy ./ --project-name=99wisdombook
```

---

## 🧪 Step 4: Test API Endpoints

After deployment, test your API endpoints:

### Base URL
```
https://99wisdombook.org/api
```

### Test Login (Default Admin)
```bash
curl -X POST https://99wisdombook.org/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "admin123"
  }'
```

Expected response:
```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "admin",
    "name": "Administrator",
    "role": "admin",
    "permissions": ["korean", "english", "chinese", "japanese", ...]
  },
  "token": "..."
}
```

### Test Registration
```bash
curl -X POST https://99wisdombook.org/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "password": "test123",
    "name": "Test User",
    "email": "test@example.com"
  }'
```

### Test Get Users (Admin Only)
```bash
curl -X GET https://99wisdombook.org/api/users \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

---

## 🔄 Step 5: Update Frontend Files

The next step is to update `index.html` and `admin.html` to use the API instead of localStorage.

I'll create updated versions of these files that:
1. Call API endpoints for login/register
2. Use API for admin operations (CRUD)
3. Implement real-time polling for dashboard updates
4. Maintain backward compatibility

---

## 📊 Database Schema

The database includes the following table:

### `users` table
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key (auto-increment) |
| username | TEXT | Unique username |
| password | TEXT | SHA-256 hashed password |
| name | TEXT | Display name |
| email | TEXT | Email address (optional) |
| role | TEXT | 'user' or 'admin' |
| permissions | TEXT | JSON array of language permissions |
| created_at | TIMESTAMP | Registration date |
| updated_at | TIMESTAMP | Last update date |
| last_login | TIMESTAMP | Last login time |

---

## 🔐 Security Notes

1. **Change Default Admin Password**
   - Login with `admin/admin123`
   - Immediately change the password via admin panel

2. **Password Hashing**
   - All passwords are hashed using SHA-256
   - Never store plain text passwords

3. **API Authentication**
   - Currently uses simple Bearer token
   - For production, consider implementing JWT tokens

4. **CORS**
   - Currently allows all origins (`*`)
   - For production, restrict to your domain

---

## 🎉 Success Indicators

You've successfully set up the database when:
- ✅ D1 database created and schema initialized
- ✅ Database bound to Cloudflare Pages project
- ✅ API endpoints respond correctly
- ✅ Can login with admin credentials
- ✅ Can register new users
- ✅ Admin can view all users

---

## 🐛 Troubleshooting

### Database not found error
- Verify database_id in wrangler.toml matches your D1 database
- Check D1 binding in Cloudflare Pages settings

### API returns 404
- Ensure `functions/api/[[path]].js` is deployed
- Check Cloudflare Pages Functions logs

### CORS errors
- API includes CORS headers
- If still issues, check browser console for specific error

---

## 📞 Next Steps

After database setup is complete:
1. Test all API endpoints
2. Update frontend files (index.html, admin.html)
3. Implement real-time dashboard updates
4. Migrate existing localStorage users (if needed)
5. Test cross-device synchronization

---

**Ready to proceed? Let me know if you need any clarification or help with any step!**
