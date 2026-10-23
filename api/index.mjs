// Vercel serverless function: the whole Express API (built to backend/dist by the build command).
// vercel.json sends every /api/* request here; the app sees the original URL.
import { createApp } from '../backend/dist/app.js';

export default createApp();
