const video = document.getElementById('inputVideo');
const canvas = document.getElementById('outputCanvas');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const testBtn = document.getElementById('testBtn');
const placeholder = document.getElementById('cameraPlaceholder');
const fallOverlay = document.getElementById('fallOverlay');
const systemStatus = document.getElementById('systemStatus');
const alertState = document.getElementById('alertState');
const alertDescription = document.getElementById('alertDescription');
const alertPanel = document.querySelector('.alert-panel');
const statusIcon = document.getElementById('statusIcon');
const confidenceValue = document.getElementById('confidenceValue');
const orientationValue = document.getElementById('orientationValue');
const countdownValue = document.getElementById('countdownValue');
const sensitivity = document.getElementById('sensitivity');
const sensitivityText = document.getElementById('sensitivityText');
const countdownSetting = document.getElementById('countdownSetting');
const soundToggle = document.getElementById('soundToggle');
const ackBtn = document.getElementById('ackBtn');
const cancelBtn = document.getElementById('cancelBtn');
const eventLog = document.getElementById('eventLog');

let pose = null, camera = null, running = false, fallStartedAt = null;
let countdownInterval = null, lastFallTime = 0, alarmActive = false, lastFrameAt = 0;
let audioContext = null;
let currentStream = null;

function logEvent(message, type='info') {
  const empty = eventLog.querySelector('.empty-log');
  if (empty) empty.remove();
  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
  const t = document.createElement('span'); t.className = 'event-time'; t.textContent = time;
  const m = document.createElement('span'); m.className = 'event-message'; m.textContent = message;
  if (type === 'alert') m.style.color = '#c72c37';
  li.append(t,m); eventLog.prepend(li);
  while (eventLog.children.length > 8) eventLog.lastElementChild.remove();
}
function setSystemState(state, label) {
  systemStatus.className = `status-pill ${state}`;
  systemStatus.innerHTML = '<span></span> ' + label;
}
function beep() {
  if (!soundToggle.checked) return;
  try {
    // Repeating two-tone emergency-style alert until the user acknowledges or cancels it.
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const playTone = (frequency, startAt, duration) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sawtooth';
      oscillator.frequency.setValueAtTime(frequency, startAt);
      gain.gain.setValueAtTime(0.001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.16, startAt + 0.025);
      gain.gain.setValueAtTime(0.16, startAt + Math.max(0.04, duration - 0.05));
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + duration + 0.01);
    };
    const now = audioContext.currentTime;
    playTone(880, now, 0.22);
    playTone(660, now + 0.25, 0.22);
  } catch(e) { console.warn('Audio unavailable', e); }
}
let alertSoundTimer = null;
function startAlertSound() {
  stopAlertSound();
  if (!soundToggle.checked) return;
  beep();
  alertSoundTimer = window.setInterval(beep, 850);
}
function stopAlertSound() {
  if (alertSoundTimer !== null) {
    window.clearInterval(alertSoundTimer);
    alertSoundTimer = null;
  }
}
function drawSkeleton(landmarks) {
  const connections = (window.POSE_CONNECTIONS || []);
  ctx.lineWidth = Math.max(2, canvas.width / 320);
  ctx.strokeStyle = '#7df0c5';
  connections.forEach(([a,b]) => {
    const p=landmarks[a], q=landmarks[b];
    if (p && q && p.visibility > 0.35 && q.visibility > 0.35) {
      ctx.beginPath(); ctx.moveTo(p.x*canvas.width,p.y*canvas.height); ctx.lineTo(q.x*canvas.width,q.y*canvas.height); ctx.stroke();
    }
  });
  landmarks.forEach(p => {
    if (p.visibility > 0.45) {
      ctx.beginPath(); ctx.arc(p.x*canvas.width,p.y*canvas.height,Math.max(2,canvas.width/180),0,Math.PI*2);
      ctx.fillStyle='#c4fff0'; ctx.fill();
    }
  });
}
function getPoint(lm, index) { return lm[index]; }
function analyzePose(results) {
  if (!results.poseLandmarks) {
    confidenceValue.textContent='No pose';
    orientationValue.textContent='—';
    if (running && !alarmActive) setSystemState('running','Searching for person');
    return;
  }
  const lm=results.poseLandmarks;
  const ids=[11,12,23,24]; // shoulders and hips
  const visibility=ids.reduce((s,i)=>s+(lm[i]?.visibility||0),0)/ids.length;
  confidenceValue.textContent=`${Math.round(visibility*100)}%`;
  const shoulder={x:(lm[11].x+lm[12].x)/2,y:(lm[11].y+lm[12].y)/2};
  const hip={x:(lm[23].x+lm[24].x)/2,y:(lm[23].y+lm[24].y)/2};
  const dx=hip.x-shoulder.x, dy=hip.y-shoulder.y;
  const angle=Math.abs(Math.atan2(dy,dx)*180/Math.PI);
  const torsoAngle=Math.min(angle,180-angle);
  orientationValue.textContent=`${Math.round(torsoAngle)}°`;
  const avgY=(shoulder.y+hip.y)/2;
  const threshold={1:28,2:40,3:52}[sensitivity.value];
  // A suspected fall requires a near-horizontal torso plus low body position,
  // and a brief confirmation period to reduce transient false positives.
  const horizontal = torsoAngle < threshold;
  const lowPosition = avgY > ({1:0.72,2:0.62,3:0.54}[sensitivity.value]);
  const enoughVisibility=visibility > 0.45;
  const suspected=horizontal && lowPosition && enoughVisibility;
  if (suspected && !alarmActive) {
    if (!fallStartedAt) {
      fallStartedAt=Date.now();
      logEvent('Possible fall posture detected. Confirming…','alert');
    }
    const delay=Number(countdownSetting.value);
    const remaining=Math.max(0,delay-(Date.now()-fallStartedAt)/1000);
    countdownValue.textContent=`${remaining.toFixed(1)} s`;
    setSystemState('warning','Possible fall');
    alertState.textContent='Possible fall detected';
    alertDescription.textContent='Keep the person in view. An alert will activate if this posture persists.';
    if (remaining<=0 && Date.now()-lastFallTime>5000) triggerAlert();
  } else if (!suspected && !alarmActive) {
    fallStartedAt=null;
    countdownValue.textContent='—';
    setSystemState('running','Monitoring');
    alertState.textContent='No fall suspected';
    alertDescription.textContent='Person pose is visible. The system is checking posture continuously.';
  }
}
function triggerAlert() {
  alarmActive=true; lastFallTime=Date.now();
  fallOverlay.classList.remove('hidden'); alertPanel.classList.add('alerting');
  statusIcon.textContent='!'; statusIcon.style.background='#ffe7e8'; statusIcon.style.color='#c72c37';
  setSystemState('alert','Alert active');
  alertState.textContent='FALL SUSPECTED';
  alertDescription.textContent='Check the person immediately. This demo cannot contact emergency services.';
  ackBtn.classList.remove('hidden'); cancelBtn.classList.remove('hidden');
  logEvent('Fall alert activated — check the person immediately.','alert');
  beep();
}
function clearAlert(label) {
  alarmActive=false; fallStartedAt=null;
  fallOverlay.classList.add('hidden'); alertPanel.classList.remove('alerting');
  statusIcon.textContent='✓'; statusIcon.style.background=''; statusIcon.style.color='';
  ackBtn.classList.add('hidden'); cancelBtn.classList.add('hidden');
  countdownValue.textContent='—';
  if (running) {
    setSystemState('running','Monitoring');
    alertState.textContent='Monitoring resumed';
    alertDescription.textContent='The alert was cleared. Continue observing the camera feed.';
  } else {
    setSystemState('idle','Not started');
    alertState.textContent='Monitoring is off';
    alertDescription.textContent='Start the camera to analyze pose landmarks and watch for possible falls.';
  }
  logEvent(label);
}
async function startMonitoring() {
  if (running) return;
  if (!window.Pose || !window.Camera) {
    alert('Could not load the pose detection library. Check your internet connection and reload this page.');
    return;
  }
  try {
    currentStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:false});
    video.srcObject=currentStream;
    await video.play();
    canvas.width=video.videoWidth||640; canvas.height=video.videoHeight||480;
    pose=new Pose({locateFile:(file)=>`https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
    pose.setOptions({modelComplexity:1,smoothLandmarks:true,enableSegmentation:false,minDetectionConfidence:0.5,minTrackingConfidence:0.5});
    pose.onResults((results)=>{
      if (!running) return;
      const now=performance.now();
      if(lastFrameAt) document.getElementById('fpsLabel').textContent=`${Math.round(1000/(now-lastFrameAt))} FPS`;
      lastFrameAt=now;
      ctx.save(); ctx.clearRect(0,0,canvas.width,canvas.height);
      // Mirror the canvas to match the front-facing preview.
      ctx.translate(canvas.width,0); ctx.scale(-1,1);
      if(results.image) ctx.drawImage(results.image,0,0,canvas.width,canvas.height);
      if(results.poseLandmarks) drawSkeleton(results.poseLandmarks);
      ctx.restore();
      analyzePose(results);
    });
    running=true;
    placeholder.classList.add('hidden');
    startBtn.disabled=true; stopBtn.disabled=false;
    setSystemState('running','Monitoring');
    alertState.textContent='Camera active';
    alertDescription.textContent='Stand in view of the camera. Keep your full upper body visible.';
    logEvent('Camera monitoring started.');
    camera=new Camera(video,{onFrame:async()=>{if(running && pose) await pose.send({image:video});},width:640,height:480});
    await camera.start();
  } catch(err) {
    running=false;
    if(currentStream) currentStream.getTracks().forEach(t=>t.stop());
    currentStream=null;
    console.error(err);
    alert('Unable to start the camera. Allow camera permission and open this page on localhost or HTTPS.');
    logEvent('Camera start failed. Check browser permissions.');
    setSystemState('idle','Camera unavailable');
  }
}
function stopMonitoring() {
  running=false;
  if(camera && camera.stop) camera.stop();
  if(currentStream) currentStream.getTracks().forEach(t=>t.stop());
  currentStream=null; video.srcObject=null;
  if(pose && pose.close) pose.close();
  pose=null; camera=null; fallStartedAt=null; lastFrameAt=0;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  placeholder.classList.remove('hidden');
  startBtn.disabled=false; stopBtn.disabled=true;
  document.getElementById('fpsLabel').textContent='Waiting for camera';
  confidenceValue.textContent='—'; orientationValue.textContent='—'; countdownValue.textContent='—';
  clearInterval(countdownInterval);
  if(alarmActive) clearAlert('Monitoring stopped; alert cleared.');
  else {
    setSystemState('idle','Not started');
    alertState.textContent='Monitoring is off';
    alertDescription.textContent='Start the camera to analyze pose landmarks and watch for possible falls.';
  }
  logEvent('Camera monitoring stopped.');
}
soundToggle.addEventListener('change', () => {
  if (!soundToggle.checked) stopAlertSound();
  else if (alarmActive) startAlertSound();
});
sensitivity.addEventListener('input',()=>{
  sensitivityText.textContent={1:'Conservative',2:'Balanced',3:'More sensitive'}[sensitivity.value];
});
startBtn.addEventListener('click',startMonitoring);
stopBtn.addEventListener('click',stopMonitoring);
testBtn.addEventListener('click',()=>{if(!alarmActive)triggerAlert();});
ackBtn.addEventListener('click',()=>clearAlert('Alert acknowledged by user.'));
cancelBtn.addEventListener('click',()=>clearAlert('Alert marked as false alarm.'));
document.getElementById('clearLog').addEventListener('click',()=>{eventLog.innerHTML='<li class="empty-log">No events yet.</li>';});
window.addEventListener('beforeunload',()=>{if(currentStream)currentStream.getTracks().forEach(t=>t.stop());});
