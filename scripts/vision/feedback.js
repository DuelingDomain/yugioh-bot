/** Offline, local-only feedback export and actual-pipeline crop regression gate. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openDatabase } from '../../packages/shared/src/db/connection.js';
import { createVisionFeedbackService } from '../../packages/shared/src/services/vision-feedback.js';
import { RecognitionPipeline } from '../../packages/vision/src/pipeline';
import { decodeIndex } from '../../packages/vision/src/index-format';
import { validateIndexProfile } from '../../packages/vision/src/profile';
import { fullArtProfile } from '../../packages/vision/src/full-art';
import { emptyLearning, indexVersion } from '../../packages/vision/src/learning';
import { yugioh } from '../../packages/vision/src/games/yugioh';
const sha = (data) => createHash('sha256').update(data).digest('hex');
export function feedbackMetrics(rows) {
    const out = { total: rows.length, top1: 0, top5: 0, sure: 0, sureWrong: 0, errors: 0 };
    for (const row of rows) {
        const r = row.result;
        if (!r) {
            out.errors++;
            continue;
        }
        if (r.candidates[0]?.cardId === row.chosenCardId)
            out.top1++;
        if (r.candidates.slice(0, 5).some(c => c.cardId === row.chosenCardId))
            out.top5++;
        if (r.tier === 'sure') {
            out.sure++;
            if (r.candidates[0]?.cardId !== row.chosenCardId)
                out.sureWrong++;
        }
    }
    return out;
}
export function regressionFailures(before, after) {
    if (before.datasetHash !== after.datasetHash || before.metrics.total !== after.metrics.total)
        return ['Dataset changed; compare the same samples and labels'];
    const b = before.metrics, a = after.metrics, fail = [];
    if (!a.total)
        fail.push('No samples');
    if (a.top1 < b.top1)
        fail.push('Top-1 decreased');
    if (a.top5 < b.top5)
        fail.push('Top-5 decreased');
    if (a.sureWrong > b.sureWrong || (a.sure && b.sure && a.sureWrong / a.sure > b.sureWrong / b.sure))
        fail.push('Sure-but-wrong increased');
    if (a.errors > 0)
        fail.push('Recognition errors');
    return fail;
}
export async function exportApprovedFeedback(store, out, entries) {
    const samples = store.allSamples().filter(s => s.review === 'approved');
    const anchors = new Map(entries.map((e, i) => [String(e.cardId), i]));
    if (samples.some(s => !anchors.has(s.chosenCardId)))
        throw new Error('Approved labels missing from trainer entries; prepare matching trainer inputs first');
    await mkdir(out, { recursive: true, mode: 0o700 });
    if ((await readdir(out)).length)
        throw new Error('Export directory must be empty; keep dataset generations separate');
    const manifest = [], pos = [];
    let bytes = 0;
    for (const sample of samples) {
        const crop = store.crop(sample.id);
        if (!crop)
            throw new Error('Missing approved crop');
        const file = join(out, `${sample.id}.jpg`);
        await writeFile(file, crop, { mode: 0o600 });
        bytes += crop.length;
        manifest.push({ sampleId: sample.id, cardId: sample.chosenCardId, file: basename(file), sha256: sha(crop), gameId: sample.gameId, source: sample.source, originalTier: sample.tier, modelId: sample.modelId, modelSha256: sample.modelSha256, indexVersion: sample.indexVersion, space: sample.space });
        pos.push({ anchor: anchors.get(sample.chosenCardId), files: [file], w: 1, kind: 'labeled', flip: false });
    }
    await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    // Consumed directly by the ported train.py --real <list.json>.
    await writeFile(join(out, 'list.json'), JSON.stringify({ built: new Date().toISOString(), mCrop: 0, pos, neg: [] }, null, 2), { mode: 0o600 });
    return { approved: samples.length, bytes, out };
}
async function benchmark(store, options) {
    const sharp = (await import('sharp')).default, ort = await import('onnxruntime-node');
    const meta = JSON.parse(await readFile(join(options.data, `${options.prefix}.meta.json`), 'utf8'));
    validateIndexProfile(meta, options.profile);
    const binary = await readFile(join(options.data, `${options.prefix}.bin`));
    const index = decodeIndex(binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength), meta);
    let fullIndex;
    try {
        const m = JSON.parse(await readFile(join(options.data, 'yugioh-full-art.meta.json'), 'utf8'));
        validateIndexProfile(m, fullArtProfile(options.profile));
        const b = await readFile(join(options.data, 'yugioh-full-art.bin'));
        fullIndex = decodeIndex(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), m);
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
    const model = await readFile(options.model ?? join(options.data, 'models', basename(options.profile.embedding.url)));
    if (sha(model) !== options.profile.embedding.sha256)
        throw new Error('Model hash mismatch');
    const session = await ort.InferenceSession.create(model, { executionProviders: ['cpu'], intraOpNumThreads: 2, interOpNumThreads: 1 });
    const embedder = { backend: 'wasm', run: session.run.bind(session) };
    // Stored inputs are already warped cards. Detection of source frames cannot be
    // benchmarked from these privacy-limited samples; use the normal selected-quad path.
    const detector = { backend: 'wasm', run: () => { throw new Error('Crop benchmark must use the supplied full-card quad'); } };
    const pipeline = new RecognitionPipeline(options.profile, index, detector, embedder, ort.Tensor, fullIndex);
    const samples = store.allSamples().filter(s => s.review !== 'rejected' && s.gameId === options.profile.id);
    const hashes = new Map();
    for (const s of samples) {
        const crop = store.crop(s.id);
        if (!crop)
            throw new Error('Missing crop');
        hashes.set(s.id, sha(crop));
    }
    const rows = [];
    try {
        for (const s of samples) {
            pipeline.setLearning(emptyLearning());
            if (options.learning) {
                // Hold out the contributor and identical JPEGs, including their consensus
                // support and confusion evidence. A self reference is never an accuracy gain.
                const excluded = [...new Set(samples.filter(o => o.userId === s.userId || hashes.get(o.id) === hashes.get(s.id)).map(o => o.userId))];
                const learning = store.learning(excluded);
                const compatible = (r) => [index, fullIndex].some(i => i && r.gameId === options.profile.id && r.modelSha256 === options.profile.embedding.sha256 && r.indexVersion === indexVersion(i.meta) && r.layoutKey === i.meta.layoutKey && r.space === (i === fullIndex ? 'whole-card' : 'art-box'));
                pipeline.setLearning({ version: learning.version, references: learning.references.filter(compatible).map(r => ({ cardId: r.chosenCardId, embedding: r.embedding, space: r.space })), confusions: learning.confusions.filter(compatible) });
            }
            try {
                const decoded = await sharp(store.crop(s.id)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
                const result = await pipeline.recognize([{ data: decoded.data, width: decoded.info.width, height: decoded.info.height }], { card: { quad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], kind: 'face-up', confidence: 1, partial: false }, k: 5 });
                rows.push({ sampleId: s.id, chosenCardId: s.chosenCardId, result });
            }
            catch {
                rows.push({ sampleId: s.id, chosenCardId: s.chosenCardId, error: 'recognition_failed' });
            }
        }
    }
    finally {
        await session.release();
    }
    const datasetHash = sha(JSON.stringify(samples.map(s => [s.id, s.chosenCardId, hashes.get(s.id)]).sort((a, b) => a[0].localeCompare(b[0]))));
    const original = feedbackMetrics(samples.map(s => ({ chosenCardId: s.chosenCardId, result: { candidates: s.top5, tier: s.tier } })));
    const metrics = feedbackMetrics(rows);
    return { version: 1, datasetHash, modelId: options.profile.embedding.id, modelSha256: options.profile.embedding.sha256, indexVersion: indexVersion(meta), learning: options.learning, holdout: 'contributor and identical-crop users excluded from references and confusions', scope: 'Stored warped card crops; detector and unsubmitted scans are not evaluated', original, metrics, byOriginalTier: Object.fromEntries(['sure', 'not sure', 'low match'].map(t => [t, feedbackMetrics(rows.filter(r => samples.find(s => s.id === r.sampleId)?.tier === t))])), rows };
}
async function main() {
    const { positionals, values } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, baseline: { type: 'string' }, data: { type: 'string' }, profile: { type: 'string' }, model: { type: 'string' }, prefix: { type: 'string' }, 'no-learning': { type: 'boolean' } } });
    if (!['export', 'benchmark', 'prune'].includes(positionals[0] ?? ''))
        throw new Error('Usage: feedback.ts export --out <empty-dir> | benchmark --out <report.json> [--baseline <report.json>] [--data <vision-assets>] [--profile <json>] [--model <onnx>] [--prefix <index-name>] [--no-learning] | prune');
    if (!process.env.DATABASE_PATH)
        throw new Error('Set DATABASE_PATH to the collection database');
    const db = openDatabase(resolve(process.env.DATABASE_PATH));
    try {
        const store = createVisionFeedbackService(db), data = resolve(values.data ?? process.env.VISION_DATA_DIR ?? 'data/vision');
        if (positionals[0] === 'prune') {
            store.prune();
            console.log('Feedback retention and caps applied.');
            return;
        }
        if (!values.out)
            throw new Error('--out is required');
        const out = resolve(values.out);
        if (positionals[0] === 'export') {
            const training = resolve(process.env.VISION_TRAINING_DIR ?? join(data, 'training'));
            let entries;
            try {
                entries = JSON.parse(await readFile(join(training, 'train/cache/entries.json'), 'utf8'));
            }
            catch (e) {
                if (e.code !== 'ENOENT')
                    throw e;
                entries = JSON.parse(await readFile(join(training, 'index.meta.json'), 'utf8')).entries;
            }
            console.log(JSON.stringify(await exportApprovedFeedback(store, out, entries), null, 2));
            return;
        }
        const profile = values.profile ? JSON.parse(await readFile(resolve(values.profile), 'utf8')) : yugioh;
        const report = await benchmark(store, { data, profile, model: values.model, prefix: values.prefix ?? 'yugioh-index', learning: !values['no-learning'] });
        const failures = values.baseline ? regressionFailures(JSON.parse(await readFile(resolve(values.baseline), 'utf8')), report) : report.metrics.total ? report.metrics.errors ? ['Recognition errors'] : [] : ['No samples'];
        await mkdir(resolve(out, '..'), { recursive: true, mode: 0o700 });
        await writeFile(out, JSON.stringify({ ...report, gate: { compared: Boolean(values.baseline), pass: failures.length ? false : values.baseline ? true : null, failures } }, null, 2), { mode: 0o600 });
        console.log(JSON.stringify({ samples: report.metrics.total, original: report.original, current: report.metrics, gate: failures.length ? 'FAIL' : values.baseline ? 'PASS' : 'BASELINE (not compared)', failures, out }, null, 2));
        if (failures.length)
            process.exitCode = 1;
    }
    finally {
        db.close();
    }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    await main();
