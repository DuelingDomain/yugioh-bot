# Card recognition feedback

The web collects only with `REMOTE_VISION_FEEDBACK=1`. Regular users must explicitly
opt in; alpha membership grants no consent. Accounts in `OWNER_USER_IDS` default
to saving confirmations and corrections, with no opt-in prompt. The lab shows
“Saving to training set” and a toggle; an explicit opt-out is preserved. Set the env to
`0` and restart web to stop uploads and serving learned references. Account
settings and deletion remain available. Consent is asked once, stored per account,
and can be changed in `/settings/account`. The lab requires its existing lab gate.
`WEB_URL` must match the browser origin for all mutations. No external AI call is
part of collection, learning, export or benchmarking.

## Storage and scheduled cleanup

Shared migration creates `vision_feedback_preferences` and `vision_samples`.
Crops are private 0600 JPEGs in `vision-feedback/` beside `DATABASE_PATH` (or beneath
an explicit `DATA_DIR`, which must be the same for every process). Never put this
directory under public assets. Metadata includes normalized embeddings, original
candidates/tier, label/source, quality, game, model hash, preprocessing identity
and index generation. Identity is checked against the server's `VISION_DATA_DIR`
metadata. Do not put personal information in model/profile IDs.

Limits: 224px crop width, <=400px high, <=32KiB each; 96KiB streaming request cap;
60 samples/user/hour, at least 1s apart; 5,000 retained rows; 64MiB total crops;
30-day retention. Retries with the same user/crop/label/model/index are deduplicated.
Full frames, fallback/partial/covered/card-back crops, audio and transcripts are
not feedback inputs. Detection cannot certify an arbitrary object is a card;
review crops and delete unwanted examples.

The worker prunes at startup and every hour, independently of the collection
switch. Reads/writes also prune, and the SQLite writer lock serializes disk writes,
eviction and orphan cleanup. Removing an account clears rows transactionally,
then removes orphan crop files; rollback preserves both. SQLite row count and
bounded fields limit metadata growth; normal WAL/checkpoint and backups still apply.

Manual cleanup, from the repo root with Node 22 on PATH:

```sh
DATABASE_PATH=/absolute/data/bot.sqlite npx tsx scripts/vision/feedback.ts prune
```

## Learning and review

`/admin#vision` follows the owner-only console gate (`OWNER_USER_IDS`). It lists
the newest 100 confirmations/corrections, private crop previews, original top-five
scores, approve/reject/delete, confusion pairs and UTC daily tier metrics.
**Sure-but-wrong = incorrect visual winner / submitted sure confirmations**.
Top-1/top-5 and daily counts also include correct confirmations. These are
self-selected submitted samples, not accuracy over all camera reads.

The delta is derived from retained non-rejected samples. A reference is eligible
when an admin approves it or another authenticated user confirms the same label
with cosine >= .97 in the same game/model/index/preprocessing space. Up to 100
recent examples per label are considered and 512 references are served. Repeated
submissions from one user never establish consensus. Contradictory eligible labels
compete as ordinary alternatives; the confidence margin still applies. Confusion
pairs require at least two distinct users and force extra hypotheses plus a .06
independent-view margin. They never boost a similarity score.

Owner confirmations (including correct top-1 reads) and corrections are approved
atomically at ingestion using the server's owner policy. No second user or manual
approval is needed. Retrying an older pending owner sample approves it, while an
explicit moderator rejection stays rejected. Normal crop, quality, rate and
retention limits still apply; a failed save is shown in the lab.

In `/dev/vision-lab`, click a card in the live camera: the video keeps running,
the worker reads the single sharpest frame from the last second, and the detected
card flashes gold. A loading popup opens immediately, then displays a full-size
card image, catalog text/stats, tier and Confirm. Unsure reads show five pick
buttons below. Clicks outside detected cards ask you to try again. Frozen/photo
reads retain their existing behavior and keyboard controls. Catalog details use
the existing card resolver; a failed text lookup does not prevent confirmation.

The browser refreshes its delta before recognition, peek and read-all (once per
board). A refresh failure clears learning. Deleting/rejecting evidence withdraws
it on the next request; an already displayed/cached answer is not rewritten.
No separate persistent delta file can outlive a deleted sample. Model, index
and preprocessing identity must match; rebuilding an index intentionally requires
new compatible evidence. Export retained approved crops to re-embed/retrain after
a model change. No server performs live ONNX inference.

## Export approved crops for the ported trainer

Prepare trainer inputs first, using `scripts/vision/prepare-training.ts`. Export
requires an empty output directory and uses **admin-approved** samples only;
automatic consensus does not substitute for export review. It emits private
warped JPEGs, a labelled `manifest.json` without account IDs, and `list.json`
consumed directly by the existing trainer. `mCrop=0` because these crops are
already exact card warps, unlike upstream's padded video harvest.

```sh
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
export DATABASE_PATH=/absolute/data/bot.sqlite
export VISION_DATA_DIR=/absolute/data/vision
export VISION_TRAINING_DIR=/absolute/data/vision/training
npx tsx scripts/vision/feedback.ts export --out /absolute/private/feedback-dataset-1
$VISION_DATA_DIR/venv-train/bin/python scripts/vision/training/train/train.py \
  --run feedback-1 --real /absolute/private/feedback-dataset-1/list.json \
  --minutes 100 --bs 16 --workers 2 --amp none
```

Keep exports outside public assets and source control. Their manifest sample IDs
let the owner remove deleted examples. Exports are explicit offline copies: live
account deletion cannot erase copies moved elsewhere or undo a trained model.
Before every subsequent training run, rebuild from the current approved store
and remove old generations; honor deletion requests in private exports and
backups too. No export or trained weights are automatically published/installed.

## Regression gate

```sh
npx tsx scripts/vision/feedback.ts benchmark --no-learning --out /private/before.json
# Change index/model, then benchmark the SAME retained corpus:
npx tsx scripts/vision/feedback.ts benchmark --out /private/after.json \
  --baseline /private/before.json
```

Optional `--data <assets>`, `--prefix <index-name>`, `--profile <profile.json>` and
`--model <weights.onnx>` allow an isolated candidate index/model without replacing
the deployed files. Profile/model hashes and YGIX metadata are validated. Keep
both report files outside the crop store; they contain labels and sample IDs.

This runs the actual `RecognitionPipeline` with native ONNX CPU embeddings and
the selected-card path on every retained, non-rejected crop for the selected game.
It re-embeds JPEG pixels, not the previously stored vectors. Source-frame
*detection* cannot be evaluated because those frames are deliberately not stored.
Each example holds out its contributor and all users who submitted an identical
crop, including their reference support and confusion evidence. Metadata retains
original tiers; reports include original observations and new results, per-tier
counts, top-1/top-5, sure count, sure-but-wrong count and errors.

Without a baseline the output is explicitly BASELINE, not a regression pass.
The compared gate fails (exit 1) for a changed corpus/labels, reduced top-1/top-5,
increased sure-but-wrong count or rate among sure predictions, empty data, or any
recognition error. The dataset hash includes sample IDs, labels and JPEG hashes.
A passing gate is evidence for this corpus only; held-out physical webcam
performance and false acceptance still need real-player data.

## Browser verification

Use a fresh seeded **owner** E2E user and an isolated test database/server on an
unused port. The script verifies default saving with no prompt, uploads one card
crop with Confirm, checks immediate approval, pauses capture, rejects the sample,
then deletes that user's samples. Never point it at a real
player account. Example with an already-running server at 3438:

```sh
VISION_LAB_ORIGIN=http://127.0.0.1:3438 \
E2E_AUTH_SECRET=<same-test-secret-as-server> \
VISION_FEEDBACK_TEST_USER=2 \
VISION_FEEDBACK_TEST_PHOTO=/absolute/path/to/local/card-photo.jpg \
  npx tsx scripts/vision/check-feedback.ts
```

The server needs its normal offline E2E gate/secret, `REMOTE_VISION_FEEDBACK=1`,
matching `WEB_URL`, owner ID and local prepared assets. Outputs are private,
ignored `data/vision-feedback-smoke/browser.json` and `account.png`. This check
uses the actual browser Worker/WASM model, without live AI calls.

Set `VISION_FEEDBACK_TEST_LIVE=1` to additionally feed the photo through a canvas
camera stream and verify live clicks, the gold outline, advancing video and
paused capture. Set `VISION_FEEDBACK_TEST_OUTPUT` to an isolated output directory.
The smoke refuses ports 3000 and 3417. This verifies the browser camera path with
a synthetic stream, not physical-camera recognition accuracy.

After deploying this change, rebuild shared code and the vision worker, rebuild
and restart web, and reload lab browser tabs. The worker is a separately prepared
asset: `npm run build --workspace=@yugidraft/vision` (with the deployed
`VISION_DATA_DIR`) regenerates it without downloading models. No database migration,
duel-server restart, training run or index rebuild is needed.
