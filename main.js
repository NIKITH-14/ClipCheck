import * as THREE from 'three';

// ==========================================================================
// 3D Visualizer State
// ==========================================================================
let scene, camera, renderer, waveMesh, particleSystem;
let currentColor = new THREE.Color('#3b82f6');
let targetColor = new THREE.Color('#3b82f6');
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };

// ==========================================================================
// Audio Processing State
// ==========================================================================
let audioContext;
let analyserNode;
let audioSourceNode; // for file player
let micSourceNode;   // for live recording
let mediaRecorder;   // to record audio chunks
let recordedChunks = [];
let recordStartTime;
let recordTimerInterval;
let liveBlocks = []; // stores real-time analysis blocks
let animationFrameId;

// Analysis Results Cache
let currentFile = null;
let currentAnalysis = {
  score: 100,
  peakDbfs: -100,
  avgDbfs: -100,
  clippingBlocks: 0,
  deadAirDuration: 0,
  blocks: [],
  errors: []
};

// HTML Elements
const els = {
  webglContainer: document.getElementById('webgl-container'),
  statusIndicator: document.getElementById('engine-status'),
  tabUpload: document.getElementById('tab-upload'),
  tabRecord: document.getElementById('tab-record'),
  contentUpload: document.getElementById('content-upload'),
  contentRecord: document.getElementById('content-record'),
  dropZone: document.getElementById('drop-zone'),
  fileInput: document.getElementById('file-input'),
  browseBtn: document.getElementById('browse-btn'),
  fileInfoContainer: document.getElementById('file-info-container'),
  fileName: document.getElementById('file-name'),
  fileSize: document.getElementById('file-size'),
  analyzeBtn: document.getElementById('analyze-btn'),
  recordPulse: document.getElementById('record-pulse'),
  recordTimer: document.getElementById('record-timer'),
  recordStatusText: document.getElementById('record-status-text'),
  startRecordBtn: document.getElementById('start-record-btn'),
  stopRecordBtn: document.getElementById('stop-record-btn'),
  scorePanel: document.getElementById('score-panel'),
  scoreText: document.getElementById('score-text'),
  scoreRing: document.getElementById('score-progress-ring'),
  statPeakDb: document.getElementById('stat-peak-db'),
  statAvgDb: document.getElementById('stat-avg-db'),
  statClippingCount: document.getElementById('stat-clipping-count'),
  statDeadAirDuration: document.getElementById('stat-dead-air-duration'),
  verdictBanner: document.getElementById('verdict-banner'),
  verdictTitle: document.getElementById('verdict-title'),
  verdictDesc: document.getElementById('verdict-desc'),
  playerPanel: document.getElementById('player-panel'),
  audioPlayer: document.getElementById('audio-player'),
  playPauseBtn: document.getElementById('play-pause-btn'),
  timeCurrent: document.getElementById('time-current'),
  timeDuration: document.getElementById('time-duration'),
  progressContainer: document.getElementById('player-progress-container'),
  progressFill: document.getElementById('player-progress-fill'),
  playerMarkers: document.getElementById('player-markers'),
  logPanel: document.getElementById('log-panel'),
  logTableBody: document.getElementById('log-table-body'),
  btnExportLog: document.getElementById('btn-export-log'),
  placeholderPanel: document.getElementById('placeholder-panel')
};

// ==========================================================================
// 1. Three.js 3D Visualizer Setup
// ==========================================================================
function init3D() {
  const width = els.webglContainer.clientWidth;
  const height = els.webglContainer.clientHeight;

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2('#08090c', 0.012);

  camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 1000);
  camera.position.z = 7;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  els.webglContainer.appendChild(renderer.domElement);

  // 3D Sphere Geometry deformed by audio waves
  const geometry = new THREE.IcosahedronGeometry(2.3, 4);
  const positionAttr = geometry.attributes.position;
  const originalPositions = new Float32Array(positionAttr.count * 3);
  for (let i = 0; i < positionAttr.count; i++) {
    originalPositions[i * 3] = positionAttr.getX(i);
    originalPositions[i * 3 + 1] = positionAttr.getY(i);
    originalPositions[i * 3 + 2] = positionAttr.getZ(i);
  }
  geometry.userData = { originalPositions };

  const material = new THREE.MeshBasicMaterial({
    color: 0x3b82f6,
    wireframe: true,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending
  });

  waveMesh = new THREE.Mesh(geometry, material);
  scene.add(waveMesh);

  // Starfield Particles
  const particleCount = 600;
  const particleGeom = new THREE.BufferGeometry();
  const particlePositions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    particlePositions[i * 3] = (Math.random() - 0.5) * 35;
    particlePositions[i * 3 + 1] = (Math.random() - 0.5) * 35;
    particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 35;
  }
  particleGeom.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  const particleMat = new THREE.PointsMaterial({
    color: 0x00f3ff,
    size: 0.04,
    transparent: true,
    opacity: 0.4
  });
  particleSystem = new THREE.Points(particleGeom, particleMat);
  scene.add(particleSystem);

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));

  // Drag controls
  window.addEventListener('mousedown', (e) => {
    isDragging = true;
    previousMousePosition = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging || !waveMesh) return;
    const deltaX = e.clientX - previousMousePosition.x;
    const deltaY = e.clientY - previousMousePosition.y;

    waveMesh.rotation.y += deltaX * 0.007;
    waveMesh.rotation.x += deltaY * 0.007;

    previousMousePosition = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  // Handle Touch for Mobile
  window.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      isDragging = true;
      previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  });
  window.addEventListener('touchmove', (e) => {
    if (!isDragging || !waveMesh || e.touches.length !== 1) return;
    const deltaX = e.touches[0].clientX - previousMousePosition.x;
    const deltaY = e.touches[0].clientY - previousMousePosition.y;

    waveMesh.rotation.y += deltaX * 0.007;
    waveMesh.rotation.x += deltaY * 0.007;

    previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  });
  window.addEventListener('touchend', () => {
    isDragging = false;
  });

  // Handle Resize
  window.addEventListener('resize', () => {
    const w = els.webglContainer.clientWidth;
    const h = els.webglContainer.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  animate();
}

function animate() {
  requestAnimationFrame(animate);

  // Fetch real-time visualizer details if active
  let dataArray = new Uint8Array(0);
  let state = 'Standard';

  if (analyserNode) {
    dataArray = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(dataArray);

    // Identify current state during playback/recording
    if (els.audioPlayer && !els.audioPlayer.paused) {
      const t = els.audioPlayer.currentTime;
      const currentBlock = currentAnalysis.blocks.find(b => t >= b.start && t < b.end);
      if (currentBlock) {
        state = currentBlock.state;
      }
    } else if (mediaRecorder && mediaRecorder.state === 'recording') {
      state = els.statusIndicator.textContent.includes('Clipping') ? 'Clipping' : 
              els.statusIndicator.textContent.includes('Dead Air') ? 'Dead Air' :
              els.statusIndicator.textContent.includes('Studio') ? 'Studio' :
              els.statusIndicator.textContent.includes('Too Quiet') ? 'Too Quiet' : 'Standard';
    }
  }

  update3DVisuals(dataArray, state);
  renderer.render(scene, camera);
}

function update3DVisuals(freqData, state) {
  if (!waveMesh) return;

  let hexColor = '#3b82f6';
  let speedMultiplier = 1.0;
  let noiseIntensity = 0.25;

  switch (state) {
    case 'Clipping':
      hexColor = '#ff2d55';
      speedMultiplier = 3.8;
      noiseIntensity = 1.1;
      break;
    case 'Studio':
      hexColor = '#10b981';
      speedMultiplier = 1.5;
      noiseIntensity = 0.45;
      break;
    case 'Standard':
      hexColor = '#f59e0b';
      speedMultiplier = 1.0;
      noiseIntensity = 0.3;
      break;
    case 'Too Quiet':
      hexColor = '#6366f1';
      speedMultiplier = 0.4;
      noiseIntensity = 0.08;
      break;
    case 'Dead Air':
      hexColor = '#4b5563';
      speedMultiplier = 0.08;
      noiseIntensity = 0.01;
      break;
  }

  targetColor.set(hexColor);
  currentColor.lerp(targetColor, 0.08);
  waveMesh.material.color.copy(currentColor);

  // Animate Sphere Vertices
  const time = performance.now() * 0.001 * speedMultiplier;
  const geometry = waveMesh.geometry;
  const positionAttr = geometry.attributes.position;
  const original = geometry.userData.originalPositions;

  for (let i = 0; i < positionAttr.count; i++) {
    const ox = original[i * 3];
    const oy = original[i * 3 + 1];
    const oz = original[i * 3 + 2];

    const len = Math.sqrt(ox * ox + oy * oy + oz * oz);
    const nx = ox / len;
    const ny = oy / len;
    const nz = oz / len;

    // Displace vertex based on noise + frequency data
    const freqIndex = i % (freqData.length || 1);
    const freqRatio = freqData.length ? freqData[freqIndex] / 255.0 : 0.0;

    // Combine sine waves + sound frequencies
    const offset = Math.sin(ox * 2 + time * 3) * Math.cos(oy * 2.5 + time * 2.5) * noiseIntensity
                 + freqRatio * (noiseIntensity + 0.35);

    positionAttr.setXYZ(i, ox + nx * offset, oy + ny * offset, oz + nz * offset);
  }

  positionAttr.needsUpdate = true;

  // Auto Rotation
  if (!isDragging) {
    waveMesh.rotation.y += 0.004 * speedMultiplier;
    waveMesh.rotation.x += 0.0025 * speedMultiplier;
  }

  // Slow particle orbit
  particleSystem.rotation.y -= 0.0004;
}

// ==========================================================================
// 2. Audio Processing Infrastructure
// ==========================================================================
function initAudio() {
  if (window.__audioContext) {
    audioContext = window.__audioContext;
    analyserNode = window.__analyserNode;
    audioSourceNode = window.__audioSourceNode;
    return;
  }

  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 256;
  
  audioSourceNode = audioContext.createMediaElementSource(els.audioPlayer);
  audioSourceNode.connect(analyserNode);
  analyserNode.connect(audioContext.destination);

  // Cache globally to survive HMR reloads
  window.__audioContext = audioContext;
  window.__analyserNode = analyserNode;
  window.__audioSourceNode = audioSourceNode;
}

// Helper: Convert RMS to dBFS
function rmsToDbfs(rms) {
  if (rms <= 0) return -100;
  return 20 * Math.log10(rms);
}

// Helper: Classify decibel level
function classifyState(dbfs, peak) {
  if (peak >= -0.1) {
    return 'Clipping';
  }
  if (dbfs >= -18 && dbfs <= -12) {
    return 'Studio';
  }
  if (dbfs >= -24 && dbfs <= -6) {
    return 'Standard';
  }
  if (dbfs >= -45 && dbfs <= -30) {
    return 'Too Quiet';
  }
  if (dbfs < -50) {
    return 'Dead Air';
  }
  
  // Gaps interpolators
  if (dbfs > -6 && dbfs < -0.1) return 'Standard';
  if (dbfs > -30 && dbfs < -24) return 'Standard'; // treat slightly quiet as safe
  if (dbfs >= -50 && dbfs < -45) return 'Too Quiet';
  
  return 'Standard';
}

// Helper: Format Time in MM:SS.t
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`;
}

// Helper: Format Time in MM:SS (for simple player display)
function formatTimeSimple(seconds) {
  if (isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ==========================================================================
// 3. Static File Analyzer
// ==========================================================================
async function analyzeAudioBuffer(audioBuffer) {
  const sampleRate = audioBuffer.sampleRate;
  const totalDuration = audioBuffer.duration;
  const channelData = audioBuffer.getChannelData(0); // analyze first channel
  
  const blockDuration = 0.1; // 100ms blocks
  const blockSize = Math.floor(sampleRate * blockDuration);
  const totalBlocks = Math.floor(channelData.length / blockSize);
  
  const blocks = [];
  let peakMax = -100;
  let rmsSum = 0;
  let validRmsCount = 0;
  let clippingCount = 0;
  let deadAirSeconds = 0;
  
  for (let i = 0; i < totalBlocks; i++) {
    const startIdx = i * blockSize;
    const endIdx = startIdx + blockSize;
    
    let blockPeakVal = 0;
    let blockSqSum = 0;
    
    for (let s = startIdx; s < endIdx; s++) {
      const sampleVal = Math.abs(channelData[s]);
      if (sampleVal > blockPeakVal) blockPeakVal = sampleVal;
      blockSqSum += channelData[s] * channelData[s];
    }
    
    const blockRmsVal = Math.sqrt(blockSqSum / blockSize);
    const blockPeakDb = rmsToDbfs(blockPeakVal);
    const blockRmsDb = rmsToDbfs(blockRmsVal);
    
    const blockState = classifyState(blockRmsDb, blockPeakDb);
    
    // Accumulate Peak & Average statistics
    if (blockPeakDb > peakMax) peakMax = blockPeakDb;
    if (blockRmsDb > -80) { // filter noise floor from true average
      rmsSum += blockRmsDb;
      validRmsCount++;
    }
    
    if (blockState === 'Clipping') clippingCount++;
    if (blockState === 'Dead Air') deadAirSeconds += blockDuration;
    
    blocks.push({
      index: i,
      start: i * blockDuration,
      end: (i + 1) * blockDuration,
      peak: blockPeakDb,
      rms: blockRmsDb,
      state: blockState
    });
  }
  
  const finalPeakDb = peakMax;
  const finalAvgDb = validRmsCount > 0 ? (rmsSum / validRmsCount) : -100;
  
  // Calculate Score Deductions
  let score = 100;
  
  // Clipping deduction: Deduct 4% per frame block
  const clippingDeduction = clippingCount * 4;
  
  // Too Quiet deduction: Deduct 1% per frame block
  const tooQuietCount = blocks.filter(b => b.state === 'Too Quiet').length;
  const tooQuietDeduction = tooQuietCount * 1;
  
  // Dead Air deduction: Deduct 3% per continuous second
  const deadAirDeduction = Math.floor(deadAirSeconds) * 3;
  
  score = score - (clippingDeduction + tooQuietDeduction + deadAirDeduction);
  score = Math.max(0, Math.min(100, score));
  
  // Assemble Error Logs (merge adjacent blocks of the same abnormal state)
  const errors = [];
  let currentErr = null;
  
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const isAnomalous = b.state === 'Clipping' || b.state === 'Too Quiet' || b.state === 'Dead Air';
    
    if (isAnomalous) {
      if (currentErr && currentErr.state === b.state) {
        // Extend current error interval
        currentErr.end = b.end;
        if (b.peak > currentErr.peak) currentErr.peak = b.peak;
        currentErr.rmsSum += b.rms;
        currentErr.blockCount++;
      } else {
        // Close previous error if open
        if (currentErr) {
          currentErr.rms = currentErr.rmsSum / currentErr.blockCount;
          errors.push(currentErr);
        }
        // Start new error interval
        currentErr = {
          state: b.state,
          start: b.start,
          end: b.end,
          peak: b.peak,
          rmsSum: b.rms,
          blockCount: 1
        };
      }
    } else {
      if (currentErr) {
        currentErr.rms = currentErr.rmsSum / currentErr.blockCount;
        errors.push(currentErr);
        currentErr = null;
      }
    }
  }
  
  // Close any final error
  if (currentErr) {
    currentErr.rms = currentErr.rmsSum / currentErr.blockCount;
    errors.push(currentErr);
  }
  
  return {
    score,
    peakDbfs: finalPeakDb,
    avgDbfs: finalAvgDb,
    clippingBlocks: clippingCount,
    deadAirDuration: deadAirSeconds,
    blocks,
    errors
  };
}

// ==========================================================================
// 4. Live Recording Engine
// ==========================================================================
async function startLiveRecording() {
  initAudio();
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }
  
  recordedChunks = [];
  liveBlocks = [];
  recordStartTime = performance.now();
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Create node for live stream
    micSourceNode = audioContext.createMediaStreamSource(stream);
    micSourceNode.connect(analyserNode);
    
    // Start Recorder
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    
    mediaRecorder.onstop = async () => {
      els.statusIndicator.textContent = 'Engine Idle';
      els.statusIndicator.className = 'status-indicator idle';
      
      const nameEl = document.getElementById('player-track-name');
      if (nameEl) nameEl.textContent = 'Live Microphone Input';
      
      const audioBlob = new Blob(recordedChunks, { type: 'audio/wav' });
      const audioUrl = URL.createObjectURL(audioBlob);
      
      els.audioPlayer.src = audioUrl;
      els.audioPlayer.load();
      
      // Decode and analyze full recorded file
      els.statusIndicator.textContent = 'Analyzing Track...';
      els.statusIndicator.className = 'status-indicator analyzing';
      
      try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
        const results = await analyzeAudioBuffer(decodedBuffer);
        displayAnalysisResults(results);
      } catch (err) {
        console.error('Failed to decode recording:', err);
        alert('Could not decode recorded audio.');
      }
      
      els.statusIndicator.textContent = 'Engine Idle';
      els.statusIndicator.className = 'status-indicator idle';
    };
    
    mediaRecorder.start();
    
    els.statusIndicator.textContent = 'Recording Live...';
    els.statusIndicator.className = 'status-indicator recording';
    
    // UI Updates
    els.startRecordBtn.classList.add('hidden');
    els.stopRecordBtn.classList.remove('hidden');
    document.querySelector('.record-pulse-container').classList.add('recording');
    els.recordStatusText.textContent = 'Recording input stream...';
    
    // Start Recording Timer & Realtime stats scan
    runRecordingLoop();
    
  } catch (err) {
    console.error('Failed to acquire microhpone:', err);
    alert('Failed to access microphone. Please check permissions.');
  }
}

function runRecordingLoop() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
  
  // Update Timer
  const elapsed = (performance.now() - recordStartTime) / 1000;
  els.recordTimer.textContent = formatTime(elapsed);
  
  // Real-time decibel check from Analyser Node
  const bufferLength = analyserNode.fftSize;
  const timeData = new Float32Array(bufferLength);
  analyserNode.getFloatTimeDomainData(timeData);
  
  let peakVal = 0;
  let sqSum = 0;
  for (let i = 0; i < bufferLength; i++) {
    const val = Math.abs(timeData[i]);
    if (val > peakVal) peakVal = val;
    sqSum += timeData[i] * timeData[i];
  }
  
  const rmsVal = Math.sqrt(sqSum / bufferLength);
  const peakDb = rmsToDbfs(peakVal);
  const rmsDb = rmsToDbfs(rmsVal);
  
  const liveState = classifyState(rmsDb, peakDb);
  els.statusIndicator.textContent = `Live Recording - Level: ${Math.round(rmsDb)} dB (${liveState})`;
  
  // Add live blocks to trigger 3D color morph
  liveBlocks.push({ peak: peakDb, rms: rmsDb, state: liveState });
  
  recordTimerInterval = setTimeout(runRecordingLoop, 100);
}

function stopLiveRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    // Stop tracks
    micSourceNode.mediaStream.getTracks().forEach(track => track.stop());
    clearTimeout(recordTimerInterval);
    
    els.startRecordBtn.classList.remove('hidden');
    els.stopRecordBtn.classList.add('hidden');
    document.querySelector('.record-pulse-container').classList.remove('recording');
    els.recordStatusText.textContent = 'Processing final quality logs...';
  }
}

// ==========================================================================
// 5. Diagnostics Dashboard Renderer
// ==========================================================================
function displayAnalysisResults(results) {
  currentAnalysis = results;
  
  // Show panels & hide placeholders
  els.placeholderPanel.classList.add('hidden');
  els.scorePanel.classList.remove('hidden');
  els.playerPanel.classList.remove('hidden');
  els.logPanel.classList.remove('hidden');
  
  // 1. Overall Score Ring animation
  els.scoreText.textContent = results.score;
  const dashOffset = 251.2 - (251.2 * results.score) / 100;
  els.scoreRing.style.strokeDashoffset = dashOffset;
  
  // Adjust progress ring color based on score grade
  if (results.score >= 90) {
    els.scoreRing.style.stroke = 'var(--color-studio)';
  } else if (results.score >= 70) {
    els.scoreRing.style.stroke = 'var(--color-standard)';
  } else if (results.score >= 45) {
    els.scoreRing.style.stroke = 'var(--color-quiet)';
  } else {
    els.scoreRing.style.stroke = 'var(--color-clipping)';
  }
  
  // 2. Statistics Card populating
  els.statPeakDb.textContent = `${results.peakDbfs.toFixed(1)} dBFS`;
  els.statAvgDb.textContent = `${results.avgDbfs.toFixed(1)} dBFS`;
  els.statClippingCount.textContent = results.clippingBlocks;
  els.statDeadAirDuration.textContent = `${results.deadAirDuration.toFixed(1)}s`;
  
  // 3. Verdict Banner
  let verdictClass = '';
  let verdictTitle = '';
  let verdictDesc = '';
  
  if (results.score >= 90) {
    verdictTitle = '🥇 EXCELLENT STUDIO FIDELITY';
    verdictDesc = 'Pristine voice parameters. Low distortion, great dynamic range, ideal for production.';
    verdictClass = '';
  } else if (results.score >= 75) {
    verdictTitle = '🥈 SAFE BROADCAST QUALITY';
    verdictDesc = 'Overall standard bounds met. Minor level inconsistencies but safe for publication.';
    verdictClass = 'warning';
  } else if (results.score >= 50) {
    verdictTitle = '⚠️ MODERATE AUDIO ARTIFACTS';
    verdictDesc = 'Frequent clipping spikes or excessive dead air segments detected. Needs normalization.';
    verdictClass = 'warning';
  } else {
    verdictTitle = '🚨 CRITICAL QUALITY FAILURE';
    verdictDesc = 'Severe clipping distortions or heavy silent intervals. Requires immediate audio re-recording.';
    verdictClass = 'danger';
  }
  
  els.verdictBanner.className = `verdict-banner ${verdictClass}`;
  els.verdictTitle.textContent = verdictTitle;
  els.verdictDesc.textContent = verdictDesc;
  
  // Update Mini Score in Bottom Bar
  const miniScoreVal = document.getElementById('mini-score-val');
  if (miniScoreVal) {
    miniScoreVal.textContent = results.score;
    if (results.score >= 90) {
      miniScoreVal.style.color = 'var(--color-studio)';
    } else if (results.score >= 70) {
      miniScoreVal.style.color = 'var(--color-standard)';
    } else if (results.score >= 45) {
      miniScoreVal.style.color = 'var(--color-quiet)';
    } else {
      miniScoreVal.style.color = 'var(--color-clipping)';
    }
  }

  // Update Player Track Status text
  const trackStatus = document.getElementById('player-track-status');
  if (trackStatus) {
    if (results.score >= 90) {
      trackStatus.textContent = 'QA Passed: Pristine';
      trackStatus.style.color = 'var(--color-studio)';
    } else if (results.score >= 70) {
      trackStatus.textContent = 'QA Passed: Safe';
      trackStatus.style.color = 'var(--color-standard)';
    } else {
      trackStatus.textContent = 'QA Failed: Anomalies';
      trackStatus.style.color = 'var(--color-clipping)';
    }
  }

  // 4. Generate Timeline Markers
  generateTimelineMarkers(results);
  
  // 5. Populate Log Table
  populateLogTable(results);
}

function generateTimelineMarkers(results) {
  els.playerMarkers.innerHTML = '';
  const totalDur = els.audioPlayer.duration || 1; // avoid division by 0
  
  results.errors.forEach(err => {
    const leftPercent = (err.start / totalDur) * 100;
    const widthPercent = ((err.end - err.start) / totalDur) * 100;
    
    const marker = document.createElement('div');
    marker.className = `time-marker mark-${err.state.toLowerCase().replace(' ', '-')}`;
    marker.style.left = `${leftPercent}%`;
    marker.style.width = `${Math.max(0.5, widthPercent)}%`; // ensure it remains visible
    
    els.playerMarkers.appendChild(marker);
  });
}

function populateLogTable(results) {
  els.logTableBody.innerHTML = '';
  
  if (results.errors.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td colspan="5" style="text-align: center; color: var(--color-studio); font-weight: 600; padding: 24px;">
        ✨ Pristine Pass! No clipping, silent gaps, or under-amplified blocks detected.
      </td>
    `;
    els.logTableBody.appendChild(row);
    return;
  }
  
  results.errors.forEach((err, idx) => {
    const row = document.createElement('tr');
    row.id = `log-row-${idx}`;
    
    const timeStr = `${err.start.toFixed(1)}s - ${err.end.toFixed(1)}s`;
    const stateBadge = `<span class="badge badge-${err.state.toLowerCase().replace(' ', '-')}">${err.state}</span>`;
    
    let description = '';
    switch (err.state) {
      case 'Clipping':
        description = '💥 <strong>Volume Overload:</strong> Flat curves. Causes harsh, buzzing distortion.';
        break;
      case 'Too Quiet':
        description = '📉 <strong>Under-amplified:</strong> Voice buried near floor hum. Raising this adds heavy hiss.';
        break;
      case 'Dead Air':
        description = '🔇 <strong>Digital Silence:</strong> Complete absence of sound energy. Sounds like drop-out.';
        break;
    }
    
    row.innerHTML = `
      <td>${timeStr}</td>
      <td>${stateBadge}</td>
      <td>${err.peak.toFixed(1)} dBFS</td>
      <td><span class="table-desc">${description}</span></td>
      <td><button class="play-row-btn" data-start="${err.start}">Seek & Play</button></td>
    `;
    
    els.logTableBody.appendChild(row);
  });
  
  // Attach listeners to rows play button
  document.querySelectorAll('.play-row-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const startT = parseFloat(e.target.dataset.start);
      els.audioPlayer.currentTime = startT;
      els.audioPlayer.play();
      els.playPauseBtn.textContent = '⏸';
    });
  });
}

// ==========================================================================
// 6. Timeline and Audio Elements Bindings
// ==========================================================================
function bindAudioEvents() {
  els.audioPlayer.addEventListener('loadedmetadata', () => {
    els.timeDuration.textContent = formatTimeSimple(els.audioPlayer.duration);
    els.timeCurrent.textContent = formatTimeSimple(0);
  });
  
  els.audioPlayer.addEventListener('timeupdate', () => {
    const cur = els.audioPlayer.currentTime;
    const dur = els.audioPlayer.duration || 1;
    els.timeCurrent.textContent = formatTimeSimple(cur);
    els.progressFill.style.width = `${(cur / dur) * 100}%`;
    
    // Highlight matching error row in table
    highlightLogTableRow(cur);
  });
  
  els.audioPlayer.addEventListener('ended', () => {
    els.playPauseBtn.textContent = '▶';
  });
  
  els.playPauseBtn.addEventListener('click', () => {
    initAudio();
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    
    if (els.audioPlayer.paused) {
      els.audioPlayer.play();
      els.playPauseBtn.textContent = '⏸';
    } else {
      els.audioPlayer.pause();
      els.playPauseBtn.textContent = '▶';
    }
  });
  
  els.progressContainer.addEventListener('click', (e) => {
    const rect = els.progressContainer.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const seekRatio = clickX / width;
    
    els.audioPlayer.currentTime = seekRatio * els.audioPlayer.duration;
  });
}

function highlightLogTableRow(currentTime) {
  currentAnalysis.errors.forEach((err, idx) => {
    const row = document.getElementById(`log-row-${idx}`);
    if (row) {
      if (currentTime >= err.start && currentTime < err.end) {
        row.classList.add('active-row');
      } else {
        row.classList.remove('active-row');
      }
    }
  });
}

// Export Log to CSV
function exportLogToCSV() {
  if (!currentAnalysis.errors.length) return;
  
  let csvContent = 'data:text/csv;charset=utf-8,';
  csvContent += 'Start Time (s),End Time (s),Error Type,Peak dBFS,Average dBFS,Description\r\n';
  
  currentAnalysis.errors.forEach(err => {
    const startStr = err.start.toFixed(2);
    const endStr = err.end.toFixed(2);
    const description = err.state === 'Clipping' ? 'Volume Overload' : err.state === 'Too Quiet' ? 'Under-amplified' : 'Digital Silence';
    
    csvContent += `${startStr},${endStr},"${err.state}",${err.peak.toFixed(2)},${err.rmsSum / err.blockCount},"${description}"\r\n`;
  });
  
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `${currentFile ? currentFile.name.replace(/\.[^/.]+$/, "") : 'clipcheck'}_qa_log.csv`);
  document.body.appendChild(link);
  
  link.click();
  document.body.removeChild(link);
}

// ==========================================================================
// 7. Tab toggles & Drag-Drop Interfaces
// ==========================================================================
function bindUIEvents() {
  // Tabs Toggle
  els.tabUpload.addEventListener('click', () => {
    els.tabUpload.classList.add('active');
    els.tabRecord.classList.remove('active');
    els.contentUpload.classList.add('active');
    els.contentRecord.classList.remove('active');
  });
  
  els.tabRecord.addEventListener('click', () => {
    els.tabRecord.classList.add('active');
    els.tabUpload.classList.remove('active');
    els.contentRecord.classList.add('active');
    els.contentUpload.classList.remove('active');
  });
  
  // Click drop zone to trigger file picker
  els.dropZone.addEventListener('click', (e) => {
    if (e.target !== els.browseBtn) {
      els.fileInput.click();
    }
  });

  // Global window drag & drop prevention to stop file navigation
  window.addEventListener('dragover', (e) => e.preventDefault(), false);
  window.addEventListener('drop', (e) => e.preventDefault(), false);

  // Drag & Drop
  els.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.dropZone.classList.add('dragover');
  });
  
  els.dropZone.addEventListener('dragleave', () => {
    els.dropZone.classList.remove('dragover');
  });
  
  els.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleSelectedFile(e.dataTransfer.files[0]);
    }
  });
  
  els.browseBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // stop triggering zone click again
    els.fileInput.click();
  });
  
  els.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleSelectedFile(e.target.files[0]);
    }
  });
  
  els.analyzeBtn.addEventListener('click', async () => {
    if (!currentFile) return;
    
    initAudio();
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    
    els.statusIndicator.textContent = 'Analyzing Track...';
    els.statusIndicator.className = 'status-indicator analyzing';
    
    const fileReader = new FileReader();
    fileReader.onload = async (e) => {
      const arrayBuffer = e.target.result;
      try {
        const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
        const results = await analyzeAudioBuffer(decodedBuffer);
        
        // Load in HTML audio player
        const objectUrl = URL.createObjectURL(currentFile);
        els.audioPlayer.src = objectUrl;
        els.audioPlayer.load();
        
        displayAnalysisResults(results);
      } catch (err) {
        console.error('Offline audio decode failed:', err);
        alert('Decoding failed. Please upload a standard audio file (MP3, WAV).');
      }
      
      els.statusIndicator.textContent = 'Engine Idle';
      els.statusIndicator.className = 'status-indicator idle';
    };
    fileReader.readAsArrayBuffer(currentFile);
  });
  
  // Microphone Event bindings
  els.startRecordBtn.addEventListener('click', startLiveRecording);
  els.stopRecordBtn.addEventListener('click', stopLiveRecording);
  
  // CSV Export
  els.btnExportLog.addEventListener('click', exportLogToCSV);
  
  const btnExportBottom = document.getElementById('btn-export-log-bottom');
  if (btnExportBottom) {
    btnExportBottom.addEventListener('click', exportLogToCSV);
  }
}

function handleSelectedFile(file) {
  const allowedExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'webm', 'wma', 'mp4', 'mkv', 'mov', '3gp'];
  const fileExtension = file.name.split('.').pop().toLowerCase();
  const isAudioOrVideoMime = file.type.startsWith('audio/') || file.type.startsWith('video/');
  const isAudioOrVideoExt = allowedExtensions.includes(fileExtension);
  
  if (!isAudioOrVideoMime && !isAudioOrVideoExt) {
    alert('Please upload a valid audio or video file (MP3, WAV, OGG, M4A, FLAC, MP4, etc.).');
    return;
  }
  currentFile = file;
  
  const nameEl = document.getElementById('player-track-name');
  if (nameEl) nameEl.textContent = file.name;
  
  els.fileName.textContent = file.name;
  
  const sizeMb = file.size / (1024 * 1024);
  els.fileSize.textContent = `${sizeMb.toFixed(2)} MB`;
  
  els.fileInfoContainer.classList.remove('hidden');
}

// ==========================================================================
// 8. Initialization Entry Point
// ==========================================================================
window.addEventListener('DOMContentLoaded', () => {
  init3D();
  bindUIEvents();
  bindAudioEvents();
});
