import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import dotenv from 'dotenv';

import authRoutes from '@api/routes/auth.routes';
import emailRoutes from '@api/routes/email.routes';

// Load environment variables
dotenv.config();

export function createApp(): Application {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true
  }));

  // Request parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(compression());

  // Logging
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('combined'));
  }

  // Health check
  app.get('/health', (req: Request, res: Response) => {
    res.json({ 
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0'
    });
  });

  // Routes
  app.use('/api/v1', authRoutes);
  app.use('/api/v1', emailRoutes);

  // Error handling middleware
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('Error:', err);
    
    const status = (err as any).status || 500;
    const message = err.message || 'Internal server error';
    
    res.status(status).json({
      error: {
        message,
        status,
        timestamp: new Date().toISOString()
      }
    });
  });

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: {
        message: 'Route not found',
        status: 404,
        path: req.path
      }
    });
  });

  return app;
}