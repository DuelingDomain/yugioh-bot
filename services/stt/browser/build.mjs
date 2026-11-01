import { build } from 'esbuild';
import { mkdir, copyFile, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('.', import.meta.url)));
await rm('dist', { recursive: true, force: true });
await mkdir('dist/ort', { recursive: true });
await build({ entryPoints: ['index.js', 'matcher.js'], outdir: 'dist', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true });
for (const backend of ['wasm', 'webgpu']) {
  await build({ entryPoints: ['worker.js'], outfile: `dist/worker-${backend}.js`, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, alias: { 'onnxruntime-web': `onnxruntime-web/${backend}` }, plugins: [{
    name: 'serialize-webgpu-session-init',
    setup(plugin) {
      plugin.onLoad({ filter: /parakeet\.js\/src\/parakeet\.js$/ }, async ({ path }) => {
        const source = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n');
        // 1.4.4 already serializes hybrid sessions to avoid initWasm races.
        // Its strict mode needs that same ordering for the WASM decoder.
        const before = "if (backend === 'webgpu-hybrid') {\n      // avoid parallel create";
        if (!source.includes(before)) throw new Error('Recheck Parakeet session-init patch after upgrading');
        return { contents: source.replace(before, "if (backend.startsWith('webgpu')) {\n      // avoid parallel create"), loader: 'js' };
      });
    },
  }] });
  // ORT 1.24.1's /webgpu entry uses Asyncify, not the /all JSEP build.
  const name = backend === 'wasm' ? 'ort-wasm-simd-threaded' : 'ort-wasm-simd-threaded.asyncify';
  for (const suffix of ['mjs', 'wasm']) await copyFile(`node_modules/onnxruntime-web/dist/${name}.${suffix}`, `dist/ort/${name}.${suffix}`);
}
await copyFile('measure.html', 'dist/index.html');
await copyFile('METAPHONE-LICENSE', 'dist/METAPHONE-LICENSE');
console.log('Built browser API, two workers and local ORT assets in dist/');
