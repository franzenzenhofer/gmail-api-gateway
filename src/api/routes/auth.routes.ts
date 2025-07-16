import { Router, Request, Response } from 'express';
import { GmailService } from '@services/gmail.service';

const router = Router();
const gmailService = new GmailService();

/**
 * Initiate OAuth flow
 */
router.get('/auth/gmail', (req: Request, res: Response) => {
  const authUrl = gmailService.getAuthUrl();
  res.redirect(authUrl);
});

/**
 * OAuth callback
 */
router.get('/auth/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query;
  
  if (error) {
    return res.status(400).json({ error: 'Authorization denied' });
  }
  
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Authorization code missing' });
  }
  
  try {
    const tokens = await gmailService.getTokens(code);
    
    // In a real app, store tokens securely associated with user
    // For now, return them (NOT for production!)
    res.json({
      message: 'Authorization successful',
      tokens
    });
  } catch (error) {
    console.error('Token exchange error:', error);
    res.status(500).json({ error: 'Failed to exchange authorization code' });
  }
});

export default router;