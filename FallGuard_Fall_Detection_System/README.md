# FallGuard — Browser Fall Detection Demo

A responsive HTML/CSS/JavaScript prototype that uses MediaPipe Pose landmarks from a webcam to estimate posture and flag a possible fall.

## Run it
1. Extract the ZIP.
2. Open the folder in VS Code.
3. Run `index.html` through the **Live Server** extension, or serve the folder on `http://localhost`.
4. Allow camera permission and press **Start monitoring**.
5. Keep the person's upper body visible and test cautiously.

Internet is required to load MediaPipe libraries from jsDelivr. Camera access usually requires localhost or HTTPS.

## Included
- Webcam preview with pose landmark overlay
- Heuristic posture detection and configurable sensitivity
- Confirmation countdown, repeating two-tone alert sound, acknowledge/cancel controls
- Event log and responsive dashboard
- Video processed in the browser; this project contains no upload endpoint

## Important limitations
This is a learning/demo project, not a validated fall-detection or medical safety product. The current heuristic can produce false positives and false negatives, especially when the person is partly out of frame, lying down intentionally, or viewed from an unusual angle. It does not call emergency services. Do not use it as the only safety measure.
Learning Git commands for the FallGuard project.