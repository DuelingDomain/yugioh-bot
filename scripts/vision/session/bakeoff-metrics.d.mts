export interface Ranking {cardId:string;score:number}
export interface Row {truth:string|null;ranking:Ranking[]}
export interface Threshold {score:number;gap:number;accepted:number;n:number}
export function rank(scores:ArrayLike<number>,cards:string[],deck:string[]|null):Ranking[];
export function calibrate(rows:Row[]):Threshold;
export function score(rows:Row[],threshold:Threshold):{
  n:number;positive:number;negative:number;top1:number;top5:number;
  top1Rate:number|null;top5Rate:number|null;sure:number;wrongSure:number;
  zeroWrong:boolean;sureRateAtZeroWrong:number|null;positiveSureRateAtZeroWrong:number|null;threshold:Threshold;
};
export function distribution(values:number[]):{n:number;p50Ms:number|null;p95Ms:number|null};
export function markdown(report:Record<string,unknown>):string;
