import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/app';
import type { Application } from 'express';
import type { Server } from 'http';

describe('E2E API Tests', () => {
  let app: Application;
  let server: Server;
  const baseURL = 'http://localhost:3001';

  beforeAll(async () => {
    process.env.PORT = '3001';
    process.env.NODE_ENV = 'test';
    app = createApp();
    
    await new Promise<void>((resolve) => {
      server = app.listen(3001, resolve);
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
    });
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await fetch(`${baseURL}/health`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toMatchObject({
        status: 'healthy',
        timestamp: expect.any(String),
        version: expect.any(String)
      });
    });
  });

  describe('Auth Routes', () => {
    it('should redirect to Google OAuth', async () => {
      const response = await fetch(`${baseURL}/api/v1/auth/gmail`, {
        redirect: 'manual'
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toContain('accounts.google.com');
    });

    it('should handle OAuth callback errors', async () => {
      const response = await fetch(`${baseURL}/api/v1/auth/callback?error=access_denied`);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Authorization denied');
    });

    it('should require code for OAuth callback', async () => {
      const response = await fetch(`${baseURL}/api/v1/auth/callback`);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Authorization code missing');
    });
  });

  describe('Email Routes (Unauthorized)', () => {
    it('should require authentication for email list', async () => {
      const response = await fetch(`${baseURL}/api/v1/emails`);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Authentication required');
    });

    it('should require authentication for email analysis', async () => {
      const response = await fetch(`${baseURL}/api/v1/emails/123/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Authentication required');
    });
  });

  describe('Email Send Validation', () => {
    it('should validate required fields for sending email', async () => {
      const response = await fetch(`${baseURL}/api/v1/emails/send`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': 'fake-token-for-test'
        },
        body: JSON.stringify({ subject: 'Test' }) // Missing to and body
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Missing required fields');
    });
  });

  describe('404 Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await fetch(`${baseURL}/api/v1/unknown-route`);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toMatchObject({
        message: 'Route not found',
        status: 404,
        path: '/api/v1/unknown-route'
      });
    });
  });
});