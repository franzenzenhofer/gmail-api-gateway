# Gmail API Gateway - Google Apps Script Bridge 🌉

## For Users Who Can't/Won't Deal with Google Cloud Projects!

This Apps Script bridge gives you the **SAME API** as our Node.js gateway, but:
- ✅ **NO Google Cloud Project needed**
- ✅ **NO OAuth2 complexity**
- ✅ **NO hosting required**
- ✅ **Works with YOUR Gmail directly**
- ✅ **FREE to run** (within Google's quotas)

## 🚀 5-Minute Setup

### Step 1: Open Google Apps Script
1. Go to [script.google.com](https://script.google.com)
2. Click "New Project"
3. Delete the default code

### Step 2: Copy the Bridge Code
1. Copy ALL the code from `google-apps-script/SimpleBridge.gs`
2. Paste it into the Apps Script editor
3. Save the project (name it "Gmail API Bridge")

### Step 3: Add Your Gemini API Key
1. Get a free API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. In the script, find this line:
   ```javascript
   const GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY_HERE';
   ```
3. Replace with your actual key

### Step 4: Deploy as Web App
1. Click "Deploy" → "New Deployment"
2. Choose type: "Web app"
3. Settings:
   - Description: "Gmail API Bridge"
   - Execute as: **Me** (uses YOUR Gmail)
   - Who has access: **Anyone** (or "Anyone with Google account" for more security)
4. Click "Deploy"
5. **COPY THE WEB APP URL** - This is your API endpoint!

### Step 5: Authorize
1. When prompted, click "Authorize access"
2. Choose your Google account
3. Click "Advanced" → "Go to Gmail API Bridge (unsafe)"
4. Click "Allow"

## 🎉 That's It! You Now Have a Gmail API!

Your Web App URL works just like our Node.js API:

### List Emails
```bash
curl "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec?path=emails&limit=5"
```

### Get Single Email
```bash
curl "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec?path=email&id=EMAIL_ID"
```

### Send Email
```bash
curl -X POST "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec?path=send" \
  -H "Content-Type: application/json" \
  -d '{
    "to": ["recipient@example.com"],
    "subject": "Hello from Apps Script!",
    "body": "This email was sent via the Gmail API Bridge!"
  }'
```

### Analyze Email with AI
```bash
curl -X POST "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec?path=analyze&id=EMAIL_ID"
```

### Batch Process Emails
```bash
curl -X POST "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec?path=batch" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": {"label": "INBOX"},
    "options": {"addLabels": true},
    "maxEmails": 10
  }'
```

## 🔥 Advanced Features

### Gmail Add-on (Sidebar UI)
Want a UI in Gmail? The script includes a Gmail Add-on!

1. In Apps Script, click "Deploy" → "Test deployments"
2. Choose "Gmail add-on"
3. Install and open Gmail
4. You'll see AI analysis in the sidebar!

### Automatic Processing
Add these functions to process emails automatically:

```javascript
// Run every hour
function setupHourlyProcessing() {
  ScriptApp.newTrigger('processNewEmails')
    .timeBased()
    .everyHours(1)
    .create();
}

function processNewEmails() {
  const threads = GmailApp.search('is:unread', 0, 10);
  // Process each thread...
}
```

### Custom Authentication
Want to add API key authentication? Add this:

```javascript
function doGet(e) {
  // Check for API key
  if (e.parameter.apiKey !== 'YOUR_SECRET_KEY') {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  // ... rest of the code
}
```

## 📊 Quotas & Limits

Google Apps Script has generous free quotas:
- **Email read/write**: 20,000/day
- **UrlFetch (for Gemini)**: 20,000/day
- **Triggers**: 20/user
- **Execution time**: 6 min/execution

## 🛡️ Security Notes

1. **Web App Access**: 
   - "Anyone" = No Google login required (less secure)
   - "Anyone with Google account" = Requires Google login (recommended)
   
2. **Your Gmail Access**:
   - The script runs as YOU
   - It has access to YOUR Gmail
   - Be careful who you share the URL with!

3. **API Key Security**:
   - Consider using PropertiesService to store keys
   - Add request authentication if needed

## 🐛 Troubleshooting

### "Authorization required"
- Re-run the authorization flow
- Check script permissions

### "Gemini API error"
- Verify your API key is correct
- Check API quotas at console.cloud.google.com

### "Email not found"
- Email ID might be wrong
- Email might have been deleted

## 🤝 Why This Bridge Exists

Many developers want Gmail automation but:
- Setting up Google Cloud Projects is complex
- OAuth2 is confusing
- Hosting costs money
- They just want it to WORK

This bridge solves ALL those problems! Same API, zero complexity.

## 📚 Full Documentation

For complete API documentation, see the main [README.md](README.md). The Apps Script bridge supports the same endpoints!

---

**Built with ❤️ for developers who just want things to work!**