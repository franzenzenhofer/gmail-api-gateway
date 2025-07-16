/**
 * Gmail API Gateway - Simple Apps Script Bridge
 * 
 * For users who can't/won't setup Google Cloud Projects!
 * Just copy this to Apps Script and it WORKS with your Gmail!
 * 
 * NO OAuth needed - uses YOUR Gmail permissions!
 * Deploy as Web App and get an instant API!
 */

// The ONLY config you need - just your Gemini API key!
const GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY_HERE'; // Get from https://makersuite.google.com

/**
 * Handle GET requests - List and read emails
 */
function doGet(e) {
  const params = e.parameter;
  const path = params.path || 'health';
  
  try {
    switch(path) {
      case 'health':
        return jsonResponse({
          status: 'healthy',
          message: 'Gmail API Bridge running in Apps Script!',
          timestamp: new Date().toISOString()
        });
        
      case 'emails':
        // List emails just like our API!
        return listEmails(params);
        
      case 'email':
        // Get single email
        return getEmail(params.id);
        
      default:
        return jsonResponse({ error: 'Unknown path: ' + path }, 404);
    }
  } catch (error) {
    return jsonResponse({ error: error.toString() }, 500);
  }
}

/**
 * Handle POST requests - Send, analyze, process
 */
function doPost(e) {
  const params = e.parameter;
  const path = params.path || '';
  
  try {
    let data = {};
    if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    }
    
    switch(path) {
      case 'send':
        return sendEmail(data);
        
      case 'reply':
        return replyToEmail(data);
        
      case 'analyze':
        return analyzeEmail(params.id || data.id);
        
      case 'batch':
        return batchProcess(data);
        
      default:
        return jsonResponse({ error: 'Unknown path: ' + path }, 404);
    }
  } catch (error) {
    return jsonResponse({ error: error.toString() }, 500);
  }
}

/**
 * List emails - mirrors our Node.js API exactly!
 */
function listEmails(params) {
  // Build Gmail search query
  const parts = [];
  if (params.from) parts.push(`from:${params.from}`);
  if (params.to) parts.push(`to:${params.to}`);
  if (params.subject) parts.push(`subject:"${params.subject}"`);
  if (params.label) parts.push(`label:${params.label}`);
  if (params.after) parts.push(`after:${params.after}`);
  if (params.query) parts.push(params.query);
  
  const query = parts.join(' ') || 'in:inbox';
  const limit = parseInt(params.limit) || 10;
  
  // Search Gmail
  const threads = GmailApp.search(query, 0, Math.min(limit, 50));
  const emails = [];
  
  threads.forEach(thread => {
    const messages = thread.getMessages();
    messages.forEach(message => {
      emails.push({
        id: message.getId(),
        threadId: thread.getId(),
        from: message.getFrom(),
        to: message.getTo().split(',').map(e => e.trim()),
        subject: message.getSubject(),
        body: message.getPlainBody(),
        date: message.getDate().toISOString(),
        labels: thread.getLabels().map(l => l.getName()),
        snippet: message.getPlainBody().substring(0, 100) + '...'
      });
      
      if (emails.length >= limit) return;
    });
    
    if (emails.length >= limit) return;
  });
  
  return jsonResponse({ emails, count: emails.length });
}

/**
 * Get single email
 */
function getEmail(id) {
  try {
    const message = GmailApp.getMessageById(id);
    const thread = message.getThread();
    
    return jsonResponse({
      id: message.getId(),
      threadId: thread.getId(),
      from: message.getFrom(),
      to: message.getTo().split(',').map(e => e.trim()),
      cc: message.getCc() ? message.getCc().split(',').map(e => e.trim()) : [],
      subject: message.getSubject(),
      body: message.getPlainBody(),
      bodyHtml: message.getBody(),
      date: message.getDate().toISOString(),
      labels: thread.getLabels().map(l => l.getName()),
      attachments: message.getAttachments().map(a => ({
        filename: a.getName(),
        mimeType: a.getContentType(),
        size: a.getSize()
      }))
    });
  } catch (error) {
    return jsonResponse({ error: 'Email not found' }, 404);
  }
}

/**
 * Send email - with loop prevention!
 */
function sendEmail(data) {
  const { to, subject, body, cc, bcc } = data;
  
  if (!to || !subject || !body) {
    return jsonResponse({ error: 'Missing required fields' }, 400);
  }
  
  // Simple loop prevention check
  if (isEmailLoop(to[0], subject, body)) {
    return jsonResponse({ 
      error: 'Email loop detected',
      reason: 'Too many similar emails sent recently'
    }, 429);
  }
  
  try {
    const options = {};
    if (cc) options.cc = Array.isArray(cc) ? cc.join(',') : cc;
    if (bcc) options.bcc = Array.isArray(bcc) ? bcc.join(',') : bcc;
    
    GmailApp.sendEmail(
      Array.isArray(to) ? to.join(',') : to,
      subject,
      body,
      options
    );
    
    return jsonResponse({ 
      success: true,
      message: 'Email sent successfully'
    });
  } catch (error) {
    return jsonResponse({ error: error.toString() }, 500);
  }
}

/**
 * Reply to email
 */
function replyToEmail(data) {
  const { threadId, body } = data;
  
  if (!threadId || !body) {
    return jsonResponse({ error: 'Missing threadId or body' }, 400);
  }
  
  try {
    const thread = GmailApp.getThreadById(threadId);
    thread.reply(body);
    
    return jsonResponse({ 
      success: true,
      message: 'Reply sent successfully'
    });
  } catch (error) {
    return jsonResponse({ error: error.toString() }, 500);
  }
}

/**
 * Analyze email with Gemini AI
 */
function analyzeEmail(id) {
  if (!id) {
    return jsonResponse({ error: 'Missing email ID' }, 400);
  }
  
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
    return jsonResponse({ 
      error: 'Gemini API key not configured. Add your key to the script!' 
    }, 500);
  }
  
  try {
    const message = GmailApp.getMessageById(id);
    const email = {
      from: message.getFrom(),
      subject: message.getSubject(),
      body: message.getPlainBody()
    };
    
    // Call Gemini for analysis
    const analysis = callGeminiAPI(email);
    
    return jsonResponse({
      success: true,
      emailId: id,
      analysis,
      processingTime: Date.now()
    });
    
  } catch (error) {
    return jsonResponse({ error: error.toString() }, 500);
  }
}

/**
 * Batch process emails
 */
function batchProcess(data) {
  const { filter, options, maxEmails } = data;
  const limit = maxEmails || 10;
  
  // Build query from filter
  const parts = [];
  if (filter) {
    if (filter.from) parts.push(`from:${filter.from}`);
    if (filter.label) parts.push(`label:${filter.label}`);
    if (filter.query) parts.push(filter.query);
  }
  
  const query = parts.join(' ') || 'is:unread';
  const threads = GmailApp.search(query, 0, limit);
  const results = [];
  
  threads.forEach(thread => {
    const message = thread.getMessages()[0]; // First message
    
    try {
      const email = {
        from: message.getFrom(),
        subject: message.getSubject(),
        body: message.getPlainBody()
      };
      
      const analysis = callGeminiAPI(email);
      
      // Add labels if requested
      if (options && options.addLabels && analysis.category) {
        const labelName = `ai/${analysis.category}`;
        let label;
        try {
          label = GmailApp.getUserLabelByName(labelName);
        } catch (e) {
          label = GmailApp.createLabel(labelName);
        }
        thread.addLabel(label);
      }
      
      results.push({
        success: true,
        emailId: message.getId(),
        analysis,
        processingTime: Date.now()
      });
      
    } catch (error) {
      results.push({
        success: false,
        emailId: message.getId(),
        error: error.toString()
      });
    }
  });
  
  return jsonResponse({ results, processed: results.length });
}

/**
 * Call Gemini API - Real AI analysis!
 */
function callGeminiAPI(email) {
  const prompt = `Analyze this email and respond with JSON:
  
  Email from: ${email.from}
  Subject: ${email.subject}
  Body: ${email.body}
  
  Provide JSON with these fields:
  - sentiment: "positive", "negative", or "neutral"
  - category: "customer-support", "sales-inquiry", "newsletter", "personal", or "other"
  - summary: one sentence summary
  - urgency: "low", "medium", or "high"
  - intent: main purpose of the email
  - suggestedReply: appropriate response if needed
  - entities: array of {type, value} for any people, companies, dates, or amounts mentioned`;
  
  try {
    const response = UrlFetchApp.fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024
          }
        })
      }
    );
    
    const result = JSON.parse(response.getContentText());
    const text = result.candidates[0].content.parts[0].text;
    
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error('Gemini API error:', error);
  }
  
  // Fallback
  return {
    sentiment: 'neutral',
    category: 'other',
    summary: 'Unable to analyze',
    urgency: 'medium',
    intent: 'unknown',
    entities: []
  };
}

/**
 * Simple loop prevention using cache
 */
function isEmailLoop(recipient, subject, body) {
  const cache = CacheService.getScriptCache();
  const hash = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    recipient + subject + body.substring(0, 100)
  ).join('');
  
  const key = `loop_${hash}`;
  const count = cache.get(key);
  
  if (count && parseInt(count) >= 3) {
    return true; // Loop detected!
  }
  
  cache.put(key, (parseInt(count) || 0) + 1, 3600); // 1 hour
  return false;
}

/**
 * Helper to return JSON response
 */
function jsonResponse(data, status = 200) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Gmail Add-on Card UI (bonus feature!)
 */
function buildAddOn(e) {
  // This creates a sidebar in Gmail when viewing an email
  const messageId = e.gmail.messageId;
  const message = GmailApp.getMessageById(messageId);
  
  const analysis = callGeminiAPI({
    from: message.getFrom(),
    subject: message.getSubject(), 
    body: message.getPlainBody()
  });
  
  const card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('AI Analysis'))
    .addSection(
      CardService.newCardSection()
        .addWidget(CardService.newTextParagraph()
          .setText(`Sentiment: ${analysis.sentiment}\nCategory: ${analysis.category}\nUrgency: ${analysis.urgency}`))
        .addWidget(CardService.newTextParagraph()
          .setText(`Summary: ${analysis.summary}`))
    );
    
  if (analysis.suggestedReply) {
    card.addSection(
      CardService.newCardSection()
        .setHeader('Suggested Reply')
        .addWidget(CardService.newTextParagraph()
          .setText(analysis.suggestedReply))
    );
  }
  
  return card.build();
}