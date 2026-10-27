const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VIDEO_PATH = path.join(__dirname, 'input_video.mp4');

let currentFFmpegProcess = null;
let streamStatus = {
  isStreaming: false,
  streamKey: null,
  videoUrl: null,
  startedAt: null,
};

/**
 * Downloads a video file from a given URL to disk via stream
 */
async function downloadVideo(url, targetPath) {
  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'stream',
  });

  const writer = fs.createWriteStream(targetPath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

/**
 * Starts the FFmpeg streaming process
 */
function startFFmpegStream(streamKey) {
  const rtmpUrl = `rtmp://a.rtmp.youtube.com/live2/${streamKey}`;

  // FFmpeg arguments:
  // -re: Read input at native frame rate (essential for live streams)
  // -stream_loop -1: Loop input infinitely
  // -c:v libx264: Encode with H.264 (recommended by YouTube)
  // -preset veryfast / ultrafast: Keep CPU load low on cloud servers
  // -g 60: Keyframe interval (2 seconds for 30fps)
  const args = [
    '-re',
    '-stream_loop', '-1',
    '-i', VIDEO_PATH,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-b:v', '3000k',
    '-maxrate', '3500k',
    '-bufsize', '6000k',
    '-pix_fmt', 'yuv420p',
    '-g', '60',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-f', 'flv',
    rtmpUrl,
  ];

  console.log(`Starting FFmpeg with RTMP destination...`);
  const ffmpeg = spawn('ffmpeg', args);

  ffmpeg.stderr.on('data', (data) => {
    // FFmpeg logs operational stats to stderr
    console.log(`[FFmpeg]: ${data.toString().trim()}`);
  });

  ffmpeg.on('close', (code) => {
    console.log(`FFmpeg process exited with code ${code}`);
    streamStatus.isStreaming = false;
    currentFFmpegProcess = null;
  });

  ffmpeg.on('error', (err) => {
    console.error(`Failed to start FFmpeg process:`, err);
    streamStatus.isStreaming = false;
    currentFFmpegProcess = null;
  });

  return ffmpeg;
}

// POST endpoint to trigger the download & infinite live stream
app.post('/start', async (req, res) => {
  const { videoUrl, streamKey } = req.body;

  if (!videoUrl || !streamKey) {
    return res.status(400).json({
      error: 'Missing required fields: videoUrl and streamKey are required.',
    });
  }

  try {
    // 1. Stop any current stream before starting a new one
    if (currentFFmpegProcess) {
      console.log('Stopping previous stream...');
      currentFFmpegProcess.kill('SIGINT');
      currentFFmpegProcess = null;
    }

    // 2. Download the video file
    console.log(`Downloading video from ${videoUrl}...`);
    await downloadVideo(videoUrl, VIDEO_PATH);
    console.log('Video downloaded successfully.');

    // 3. Start the infinite stream
    currentFFmpegProcess = startFFmpegStream(streamKey);

    streamStatus = {
      isStreaming: true,
      streamKey: `${streamKey.slice(0, 4)}****`, // Mask stream key in memory
      videoUrl,
      startedAt: new Date().toISOString(),
    };

    return res.status(200).json({
      message: 'Video downloaded and 24/7 stream started successfully.',
      status: streamStatus,
    });
  } catch (err) {
    console.error('Error starting stream:', err);
    return res.status(500).json({
      error: 'Failed to start stream',
      details: err.message,
    });
  }
});

// Endpoint to stop the stream
app.post('/stop', (req, res) => {
  if (currentFFmpegProcess) {
    currentFFmpegProcess.kill('SIGINT');
    currentFFmpegProcess = null;
    streamStatus.isStreaming = false;
    return res.status(200).json({ message: 'Stream stopped successfully.' });
  }
  return res.status(400).json({ message: 'No active stream to stop.' });
});

// Health check / stream status
app.get('/status', (req, res) => {
  res.status(200).json(streamStatus);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Live Stream Server running on port ${PORT}`);
});
