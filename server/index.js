import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Nexus Agent Platform' });
});

// Placeholder only: no OAuth flow or user authentication is implemented yet.
app.get('/api/auth/github', (req, res) => {
  res.json({ message: 'GitHub Auth endpoint active' });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Nexus server running on port ${PORT}`);
  });
}

export default app;
