/**
 * backend.js
 *
 * A backend service that:
 *  - Downloads a video from a provided URL.
 *  - Transcodes the video into an HLS stream using FFmpeg.
 *  - Supports multiple file formats (MP4, WebM, MKV, MOV).
 *  - Maps all streams (video, audio, and soft embedded subtitles) and converts
 *    subtitle streams to WebVTT.
 *
 * Dependencies:
 *  - express
 *  - fluent-ffmpeg
 *  - node-fetch
 *  - uuid
 *  - js-yaml
 *
 * Before running:
 * 1. Install dependencies:
 *      npm install express fluent-ffmpeg node-fetch uuid js-yaml
 * 2. Ensure FFmpeg is installed and accessible.
 * 3. Create a minimal config.yml (see above) in the project root.
 * 4. Create "temp" and "public" directories in your project root.
 */

const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const fetch = require('node-fetch'); // Adjust import for node-fetch v3 if needed
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const yaml = require('js-yaml');

// Load configuration from config.yml
const configPath = path.join(__dirname, 'config.yml');
let config = {};
try {
  config = yaml.load(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  console.error('Error loading config.yml:', e);
  process.exit(1);
}

const PORT = config.app.port || 3000;

// Define directories for temporary and public files
const tempDir = path.join(__dirname, 'temp');
const publicDir = path.join(__dirname, 'public');

// Ensure required directories exist
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const app = express();

/**
 * GET /video
 * Query Parameter:
 *   - url: The URL of the source video.
 *
 * This endpoint downloads the video from the provided URL,
 * transcodes it into an HLS stream using FFmpeg (with H.264 for video, AAC for audio,
 * and converting any subtitle streams to WebVTT), and returns a JSON object with
 * the URL to the generated manifest file.
 */
app.get('/video', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).send('Video URL is required');
  }

  // Generate unique identifiers to avoid collisions
  const uniqueId = uuidv4();
  const inputFile = path.join(tempDir, `input_${uniqueId}`);
  const outputDir = path.join(publicDir, uniqueId);
  const outputManifest = path.join(outputDir, 'stream.m3u8');

  try {
    // Create an output directory for this video stream
    fs.mkdirSync(outputDir, { recursive: true });

    // Download the video from the provided URL
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error('Failed to download video');
    }
    const videoBuffer = await response.buffer();
    fs.writeFileSync(inputFile, videoBuffer);

    // Use FFmpeg to convert the downloaded video into an HLS stream.
    // This command:
    //  - Maps all streams from the input.
    //  - Transcodes video to H.264 (libx264) and audio to AAC.
    //  - Converts any subtitle streams to WebVTT.
    ffmpeg(inputFile)
      .outputOptions([
        '-map', '0',                  // Map all streams from the input
        '-c:v', 'libx264',            // Transcode video to H.264
        '-c:a', 'aac',                // Transcode audio to AAC
        '-c:s', 'webvtt',             // Convert subtitle streams to WebVTT
        '-profile:v', 'baseline',     // Ensure broad compatibility
        '-level', '3.0',
        '-start_number', '0',
        '-hls_time', '10',            // Duration of each HLS segment (in seconds)
        '-hls_list_size', '0',        // Include all segments in the playlist
        '-f', 'hls'                   // Output format is HLS
      ])
      .output(outputManifest)
      .on('end', () => {
        // On success, send back the manifest URL.
        // The client can access the stream at: /<uniqueId>/stream.m3u8
        res.json({ streamUrl: `/${uniqueId}/stream.m3u8` });
        // Clean up the temporary input file.
        fs.unlink(inputFile, (err) => {
          if (err) {
            console.error('Error deleting temporary input file:', err);
          }
        });
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        res.status(500).send('Error processing video');
      })
      .run();
  } catch (error) {
    console.error('Error in /video endpoint:', error);
    res.status(500).send('Error processing video');
  }
});

// Serve static files (e.g., generated HLS streams) from the public directory
app.use(express.static(publicDir));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
