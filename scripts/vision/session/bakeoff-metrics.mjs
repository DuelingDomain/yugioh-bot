// Per-card max across artworks/rotations; calibration uses validation rows only.
export function rank(scores, cards, deck) {
  const allowed = deck === null ? null : new Set(deck.map(String));
  const byCard = new Map();
  for (let i=0;i<cards.length;i++) {
    const cardId=String(cards[i]);
    if(cardId==='-1'||allowed&&!allowed.has(cardId))continue;
    byCard.set(cardId,Math.max(byCard.get(cardId)??-Infinity,scores[i]));
  }
  return [...byCard].map(([cardId,score])=>({cardId,score})).sort((a,b)=>b.score-a.score||a.cardId.localeCompare(b.cardId)).slice(0,5);
}

function evidence(row) {
  const first=row.ranking[0],second=row.ranking[1];
  return {score:first?.score??-Infinity,gap:first?first.score-(second?.score??-1):-Infinity,
    correct:row.truth!==null&&first?.cardId===String(row.truth)};
}

export function calibrate(rows) {
  // Fixed grid chosen before test. One next-float cutoff above the observed
  // highest mistake at each margin; strict >= is shared with test evaluation.
  let best={score:Infinity,gap:Infinity,accepted:0,n:rows.length};
  const evidenceRows=rows.map(evidence);
  for(const gap of [0,.01,.02,.03,.05,.08,.1,.15,.2,.3,.5]) {
    const eligible=evidenceRows.filter(r=>r.gap>=gap&&Number.isFinite(r.score));
    const mistakes=eligible.filter(r=>!r.correct).map(r=>r.score);
    const cutoff=mistakes.length?Math.max(...mistakes)+1e-7:-1;
    const accepted=eligible.filter(r=>r.correct&&r.score>=cutoff).length;
    if(accepted>best.accepted)best={score:cutoff,gap,accepted,n:rows.length};
  }
  // JSON-safe reject-all; cosine cannot exceed 1 after normalization.
  return Number.isFinite(best.score)?best:{...best,score:2,gap:2};
}

export function score(rows, threshold) {
  let positive=0,top1=0,top5=0,sure=0,wrongSure=0;
  for(const row of rows) {
    const e=evidence(row);
    if(row.truth!==null) {
      positive++;
      top1+=Number(e.correct);
      top5+=Number(row.ranking.some(v=>v.cardId===String(row.truth)));
    }
    if(e.score>=threshold.score&&e.gap>=threshold.gap) {
      sure++;
      wrongSure+=Number(!e.correct);
    }
  }
  return {n:rows.length,positive,negative:rows.length-positive,top1,top5,
    top1Rate:positive?top1/positive:null,top5Rate:positive?top5/positive:null,
    sure,wrongSure,zeroWrong:wrongSure===0,
    sureRateAtZeroWrong:wrongSure===0&&rows.length?sure/rows.length:null,
    positiveSureRateAtZeroWrong:wrongSure===0&&positive?sure/positive:null,threshold};
}

export function distribution(values) {
  const sorted=[...values].sort((a,b)=>a-b);
  return {n:sorted.length,p50Ms:sorted[Math.ceil(sorted.length*.5)-1]??null,
    p95Ms:sorted[Math.ceil(sorted.length*.95)-1]??null};
}

export function markdown(report) {
  const pct=v=>v===null?'—':`${(v*100).toFixed(2)}%`;
  const ms=v=>v===null?'—':v.toFixed(2);
  const lines=['# Embedder bake-off browser results','',
    `Browser: ${report.browser}; CPU: ${report.cpu}; GPU: ${report.gpu}; data: ${report.frozenSha256}`,
    '', 'Sure thresholds fixed on calibration; wrong test sure => FAIL, no zero-wrong rate.',
    '', '| Candidate | Export / backend | Deck | Test + / − | Top-1 | Top-5 | Sure at 0 wrong | Wrong sure | Warm crop p50 / p95 ms | Model MB |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  for(const run of report.runs) {
    if(run.error||run.skipped) {
      lines.push(`| ${run.candidate} | ${run.backend} | — | — | — | — | — | — | ${String(run.error??run.skipped).replaceAll('|','/')} | — |`);
      continue;
    }
    for(const mode of ['with','without']) {
      const s=run.metrics[mode];
      lines.push(`| ${run.candidate} | ${run.precision} / ${run.backend} | ${mode} | ${s.positive} / ${s.negative} | ${pct(s.top1Rate)} | ${pct(s.top5Rate)} | ${pct(s.sureRateAtZeroWrong)} | ${s.wrongSure} | ${ms(run.latency.p50Ms)} / ${ms(run.latency.p95Ms)} | ${(run.bytes/1e6).toFixed(2)} |`);
    }
  }
  return lines.join('\n')+'\n';
}
