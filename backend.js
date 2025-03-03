/**
 * backend.js
 *
 * A comprehensive backend server that:
 *  - Downloads a video from a provided URL.
 *  - Transcodes the video to an HLS stream using FFmpeg.
 *  - Downloads subtitle files and converts SRT to WebVTT.
 *
 * Dependencies:
 *  - express
 *  - fluent-ffmpeg
 *  - node-fetch
 *  - uuid
 *  - js-yaml
 *
 * Before running:
 * 1. Install Node packages:
 *    npm install express fluent-ffmpeg node-fetch uuid js-yaml
 * 2. Ensure FFmpeg is installed and accessible in your PATH.
 * 3. Create "temp" and "public" directories in your project root.
 * 4. Create a minimal config.yml file (see sample config.yml).
 */

const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const fetch = require('node-fetch'); // For node-fetch v3, adjust your import if needed
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

// Define directories (hard-coded in this example)
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
 * Query Parameters:
 *  - url: The URL of the source video.
 *
 * This endpoint downloads the video, converts it to an HLS stream using FFmpeg,
 * and returns a JSON object with the URL to the manifest file.
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
    // Create output directory for this video stream
    fs.mkdirSync(outputDir, { recursive: true });

    // Download the video from the provided URL
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error('Failed to download video');
    }
    const videoBuffer = await response.buffer();
    fs.writeFileSync(inputFile, videoBuffer);

    // Use FFmpeg to convert the downloaded video into an HLS stream
    ffmpeg(inputFile)
      .outputOptions([
        '-profile:v baseline', // Ensures broad compatibility
        '-level 3.0',
        '-start_number 0',
        '-hls_time 10',
        '-hls_list_size 0',
        '-f hls'
      ])
      .output(outputManifest)
      .on('end', () => {
        // After processing, send back the manifest URL.
        // The client can access the stream at: /<uniqueId>/stream.m3u8
        res.json({ streamUrl: `/${uniqueId}/stream.m3u8` });
        // Clean up the downloaded input file
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

/**
 * GET /subtitle
 * Query Parameters:
 *  - url: The URL of the subtitle file.
 *  - format (optional): The desired output subtitle format (defaults to "vtt").
 *
 * This endpoint downloads a subtitle file, converts it to WebVTT if necessary,
 * and returns the processed subtitle text.
 */
app.get('/subtitle', async (req, res) => {
  const subtitleUrl = req.query.url;
  const format = req.query.format || 'vtt'; // Default to WebVTT
  if (!subtitleUrl) {
    return res.status(400).send('Subtitle URL is required');
  }

  try {
    const response = await fetch(subtitleUrl);
    if (!response.ok) {
      throw new Error('Failed to download subtitle file');
    }
    let subtitleText = await response.text();

    // Convert SRT to WebVTT if needed
    if (subtitleUrl.endsWith('.srt') && format === 'vtt') {
      subtitleText = convertSrtToVtt(subtitleText);
    }
    // Additional processing for other formats can be added here

    res.type('text/vtt');
    res.send(subtitleText);
  } catch (error) {
    console.error('Error in /subtitle endpoint:', error);
    res.status(500).send('Error processing subtitle');
  }
});

/**
 * Helper function: convertSrtToVtt
 *
 * Converts SRT subtitle content to WebVTT format by:
 *  - Prepending the "WEBVTT" header.
 *  - Replacing comma-separated millisecond values with dot-separated values.
 *
 * @param {string} srt - The SRT file content.
 * @returns {string} - The converted WebVTT content.
 */
function convertSrtToVtt(srt) {
  return 'WEBVTT\n\n' + srt
    .replace(/\r+/g, '')
    .trim()
    .split('\n')
    .map(line => line.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2'))
    .join('\n');
}

// Serve static files (such as the generated HLS streams) from the public directory
app.use(express.static(publicDir));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
