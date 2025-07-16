import { createApp } from './app';

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    const app = createApp();
    
    const server = app.listen(PORT, () => {
      console.log(`🚀 Gmail API Gateway running on port ${PORT}`);
      console.log(`📧 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
      console.log(`🔐 OAuth start: http://localhost:${PORT}/api/v1/auth/gmail`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, closing server...');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received, closing server...');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();