/**
 * Gmail API Gateway - Google Apps Script Implementation
 * 
 * This provides the EXACT SAME API as the Node.js gateway but runs
 * entirely in Google Apps Script with native Gmail access.
 * 
 * Key advantages:
 * - No OAuth needed (uses user's Gmail directly)
 * - Runs in Google's infrastructure
 * - Can be triggered by Gmail events
 * - Free hosting via Google
 */

// Import all modules
function getModules() {
  return {
    config: Configuration,
    gmail: GmailService,
    ai: AIService,
    loopPrevention: LoopPreventionService,
    processor: EmailProcessor,
    routes: Routes
  };
}

/**
 * Web App entry points - these handle HTTP requests
 */
function doGet(e) {
  return Routes.handleGet(e);
}

function doPost(e) {
  return Routes.handlePost(e);
}

/**
 * Gmail Add-on entry point - for sidebar UI
 */
function onGmailMessage(e) {
  const messageId = e.gmail.messageId;
  const accessToken = e.gmail.accessToken;
  const message = GmailApp.getMessageById(messageId);
  
  // Analyze the current email
  const analysis = AIService.analyzeEmail({
    from: message.getFrom(),
    subject: message.getSubject(),
    body: message.getPlainBody()
  });
  
  // Build card UI
  const card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader()
      .setTitle('Gmail AI Analysis')
      .setImageUrl('https://www.google.com/images/icons/product/gmail-64.png'))
    .addSection(buildAnalysisSection(analysis))
    .addSection(buildActionsSection(messageId, analysis))
    .build();
    
  return [card];
}

/**
 * Build analysis display section
 */
function buildAnalysisSection(analysis) {
  const section = CardService.newCardSection()
    .setHeader('Email Analysis');
    
  // Sentiment with emoji
  const sentimentEmoji = {
    positive: '😊',
    negative: '😟', 
    neutral: '😐'
  };
  
  section.addWidget(CardService.newKeyValue()
    .setTopLabel('Sentiment')
    .setContent(`${sentimentEmoji[analysis.sentiment]} ${analysis.sentiment}`)
    .setBottomLabel(`Confidence: ${(analysis.confidence * 100).toFixed(0)}%`));
    
  section.addWidget(CardService.newKeyValue()
    .setTopLabel('Category')
    .setContent(analysis.category)
    .setIcon(CardService.Icon.BOOKMARK));
    
  section.addWidget(CardService.newKeyValue()
    .setTopLabel('Summary')
    .setContent(analysis.summary)
    .setMultiline(true));
    
  section.addWidget(CardService.newKeyValue()
    .setTopLabel('Urgency')
    .setContent(analysis.urgency.toUpperCase())
    .setIcon(analysis.urgency === 'high' ? CardService.Icon.CLOCK : CardService.Icon.EVENT));
    
  if (analysis.entities.length > 0) {
    const entities = analysis.entities.map(e => 
      `${e.type}: ${e.value}`
    ).join('\n');
    
    section.addWidget(CardService.newKeyValue()
      .setTopLabel('Entities Detected')
      .setContent(entities)
      .setMultiline(true));
  }
  
  return section;
}

/**
 * Build actions section
 */
function buildActionsSection(messageId, analysis) {
  const section = CardService.newCardSection()
    .setHeader('Actions');
    
  // Smart reply button
  if (analysis.suggestedReply) {
    section.addWidget(CardService.newTextButton()
      .setText('Generate Smart Reply')
      .setOnClickAction(CardService.newAction()
        .setFunctionName('generateSmartReply')
        .setParameters({
          messageId: messageId,
          reply: analysis.suggestedReply
        })));
  }
  
  // Add label button
  section.addWidget(CardService.newTextButton()
    .setText(`Label as ${analysis.category}`)
    .setOnClickAction(CardService.newAction()
      .setFunctionName('addAILabel')
      .setParameters({
        messageId: messageId,
        category: analysis.category
      })));
      
  // Process similar emails
  section.addWidget(CardService.newTextButton()
    .setText('Process Similar Emails')
    .setOnClickAction(CardService.newAction()
      .setFunctionName('processSimilarEmails')
      .setParameters({
        category: analysis.category
      })));
      
  return section;
}

/**
 * Action handlers for Gmail Add-on
 */
function generateSmartReply(e) {
  const messageId = e.parameters.messageId;
  const suggestedReply = e.parameters.reply;
  
  const message = GmailApp.getMessageById(messageId);
  const thread = message.getThread();
  
  // Create draft with smart reply
  thread.createDraftReply(suggestedReply);
  
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification()
      .setText('Smart reply draft created!'))
    .build();
}

function addAILabel(e) {
  const messageId = e.parameters.messageId;
  const category = e.parameters.category;
  
  const message = GmailApp.getMessageById(messageId);
  const thread = message.getThread();
  
  // Create or get label
  const labelName = `ai/${category}`;
  let label;
  try {
    label = GmailApp.getUserLabelByName(labelName);
  } catch (e) {
    label = GmailApp.createLabel(labelName);
  }
  
  thread.addLabel(label);
  
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification()
      .setText(`Labeled as ${category}`))
    .build();
}

function processSimilarEmails(e) {
  const category = e.parameters.category;
  
  // This would trigger batch processing
  const processed = EmailProcessor.processBatch({
    filter: { label: 'unprocessed' },
    options: { 
      categorize: true,
      addLabels: true 
    },
    maxEmails: 10
  });
  
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification()
      .setText(`Processed ${processed.length} similar emails`))
    .build();
}

/**
 * Time-based triggers for automation
 */
function setupTriggers() {
  // Process inbox every hour
  ScriptApp.newTrigger('processInbox')
    .timeBased()
    .everyHours(1)
    .create();
    
  // Clean up old loops data daily
  ScriptApp.newTrigger('cleanupLoopData')
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();
}

/**
 * Process inbox automatically
 */
function processInbox() {
  const threads = GmailApp.search('is:unread', 0, 10);
  
  threads.forEach(thread => {
    const messages = thread.getMessages();
    const unreadMessages = messages.filter(m => m.isUnread());
    
    unreadMessages.forEach(message => {
      try {
        // Check for auto-reply loops first
        const loopCheck = LoopPreventionService.checkForLoop({
          from: message.getFrom(),
          subject: message.getSubject(),
          body: message.getPlainBody(),
          threadId: thread.getId()
        });
        
        if (!loopCheck.isLoop) {
          // Analyze email
          const analysis = AIService.analyzeEmail({
            from: message.getFrom(),
            subject: message.getSubject(),
            body: message.getPlainBody()
          });
          
          // Add AI label
          if (analysis.category && analysis.category !== 'other') {
            const labelName = `ai/${analysis.category}`;
            let label;
            try {
              label = GmailApp.getUserLabelByName(labelName);
            } catch (e) {
              label = GmailApp.createLabel(labelName);
            }
            thread.addLabel(label);
          }
          
          // Auto-respond to high priority customer support
          if (analysis.category === 'customer-support' && 
              analysis.urgency === 'high' && 
              analysis.suggestedReply) {
            thread.reply(analysis.suggestedReply);
          }
        }
        
        // Mark as read
        message.markRead();
        
      } catch (error) {
        console.error('Error processing message:', error);
      }
    });
  });
}

/**
 * Clean up old loop prevention data
 */
function cleanupLoopData() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const allProps = scriptProperties.getProperties();
  const now = Date.now();
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  
  Object.keys(allProps).forEach(key => {
    if (key.startsWith('loop_')) {
      try {
        const data = JSON.parse(allProps[key]);
        if (data.timestamp < oneDayAgo) {
          scriptProperties.deleteProperty(key);
        }
      } catch (e) {
        // Invalid data, delete it
        scriptProperties.deleteProperty(key);
      }
    }
  });
}

/**
 * OAuth2 implementation for external access
 * This allows the Apps Script to act like the Node.js gateway
 */
function getOAuthService() {
  return OAuth2.createService('Gmail')
    .setAuthorizationBaseUrl('https://accounts.google.com/o/oauth2/auth')
    .setTokenUrl('https://accounts.google.com/o/oauth2/token')
    .setClientId(Configuration.OAUTH_CLIENT_ID)
    .setClientSecret(Configuration.OAUTH_CLIENT_SECRET)
    .setCallbackFunction('authCallback')
    .setPropertyStore(PropertiesService.getUserProperties())
    .setScope('https://www.googleapis.com/auth/gmail.modify')
    .setParam('access_type', 'offline')
    .setParam('approval_prompt', 'force');
}

function authCallback(request) {
  const service = getOAuthService();
  const authorized = service.handleCallback(request);
  
  if (authorized) {
    return HtmlService.createHtmlOutput('Success! You can close this tab.');
  } else {
    return HtmlService.createHtmlOutput('Denied. You can close this tab.');
  }
}