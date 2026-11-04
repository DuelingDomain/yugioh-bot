# Camera lock brightness recovery

User-approved scope: preserve the owner's auto picture when freezing webcam controls; recover manual exposure for about 1.5 s or restore auto. One regression test in an existing file, targeted checks, WIP commit, no deployment.

Root cause: `controls()` trusts the cached `getSettings().exposureTime` as a live auto exposure. The old lock retries that same stale value three times. Its fixed-delay measurement can accept queued auto frames, and glare rollback checks settings without checking restored pixels. Chromium's `ImageCapture::GetMediaTrackSettings()` copies `settings_`; it does not poll the sensor. Windows log2 exposure is converted to the web API's 100 microsecond units by Chromium; do not apply a second Windows conversion or clamp an unknown exposure to minimum.

Sources:
- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/imagecapture/image_capture.cc
- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/capture/video/win/video_capture_device_utils_win.cc
- https://w3c.github.io/mediacapture-image/#exposure-time

Implementation sequence:
- [x] Add one regression case to `packages/web/tests/remote-video.test.ts`, with a simulated persistent webcam: stale/quantized exposure, delayed/stalled frames, rejected/ineffective writes, and glare rollback. Run only that case and observe failure.
- [x] In `camera-lock.ts`, replace repeated stale locks with bounded brightness feedback on the advertised numeric range and step. Require fresh stable post-write samples and an auto luma ratio of 0.75–1.33. Restore all controls to continuous if validation, recovery, or glare rollback fails. Never assume nonpositive or unknown exposure units are valid web exposure times.
- [x] In `use-camera-lock.ts`, tag measurements with delivered-frame counters. Keep the controller independent of watcher baselines; `resetBaselines()` only updates detector state and its stable callback cannot restart `useCameraLock`.
- [x] Keep anti-glare at most three steps and a conservative floor of 75% of auto. Validate rollback using fresh pixels; return to auto on any unverified rollback. Surface “Camera lock not supported — auto kept”, including after delayed writes finish.
- [x] Run the single regression and a targeted TypeScript check, review the diff, remove generated output, and commit with a WIP message. Owner's Windows Chrome USB webcam remains unverified here.

Review correction: Chromium's `WebMediaPlayerMS::CurrentTime()` advances with playback time, even without new camera pixels. Freshness uses `requestVideoFrameCallback` deliveries (decoded frame count fallback), with callback cancellation on measurement stop/source replacement. The regression simulates advancing playback time with no delivered frames. Its Windows exposure model truncates log2 toward zero, as Chromium does. Independent read-only review found no remaining blocking issues after those corrections.

Validation: the single targeted Vitest case passes across eleven webcam scenarios (seven unrelated cases skipped); targeted TypeScript for the controller, hook and lock control passes with no emit/incremental output. No browser build or deployment run. Build output removed from this feature worktree before the WIP commit. Owner Windows Chrome hardware remains unverified.
