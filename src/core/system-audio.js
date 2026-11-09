const path = require('path');
const { fileURLToPath } = require('url');

function isAudioCapturePage(url) {
  try {
    return path.resolve(fileURLToPath(url)) === path.resolve(__dirname, '../../index.html');
  } catch (_) {
    return false;
  }
}

function allowAudioCapturePermission(url, permission) {
  return isAudioCapturePage(url) && ['media', 'display-capture'].includes(permission);
}

// Use Windows process loopback so surround-sound endpoints do not have to
// accept Chromium's stereo capture format. This captures playback on all
// outputs, including a call routed to a non-default headset.
function configureSystemAudioCapture(session) {
  session.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const frame = request.frame;
      const trusted = frame && frame === frame.top &&
        isAudioCapturePage(frame.url);
      if (process.platform !== 'win32' || !trusted || !request.audioRequested) {
        callback(null);
        return;
      }
      if (frame.isDestroyed()) {
        callback(null);
        return;
      }
      // Supply our own frame for the required video track. No monitor capture
      // is needed for speaker audio; the renderer immediately stops video.
      // Chromium's loopbackAllDevices ID is passed through by Electron's
      // DisplayMediaDeviceChosen string-audio handler (Electron 44).
      callback({ video: frame, audio: 'loopbackAllDevices' });
    } catch (_) {
      callback(null);
    }
  });
}

module.exports = { configureSystemAudioCapture, allowAudioCapturePermission };
