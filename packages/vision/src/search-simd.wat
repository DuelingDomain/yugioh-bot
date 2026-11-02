;; Float64 lanes preserve the scalar dot-product precision; raw int8 rows are
;; expanded once to float32 (exactly), never quantized a second time.
(module
 (memory (export "memory") 1)
 (func (export "dots") (param $query i32) (param $rows i32) (param $out i32) (param $count i32) (param $dim i32)
  (local $r i32) (local $d i32) (local $q i32) (local $v i32) (local $a v128) (local $b v128)
  (block $end (loop $row
   (br_if $end (i32.ge_u (local.get $r) (local.get $count)))
   (local.set $d (i32.const 0))
   (local.set $a (v128.const f64x2 0 0)) (local.set $b (v128.const f64x2 0 0))
   (loop $col
    (local.set $q (i32.add (local.get $query) (i32.shl (local.get $d) (i32.const 2))))
    (local.set $v (i32.add (local.get $rows) (i32.shl (i32.add (i32.mul (local.get $r) (local.get $dim)) (local.get $d)) (i32.const 2))))
    (local.set $a (f64x2.add (local.get $a) (f64x2.mul
      (f64x2.promote_low_f32x4 (v128.load64_zero (local.get $q)))
      (f64x2.promote_low_f32x4 (v128.load64_zero (local.get $v))))))
    (local.set $b (f64x2.add (local.get $b) (f64x2.mul
      (f64x2.promote_low_f32x4 (v128.load64_zero offset=8 (local.get $q)))
      (f64x2.promote_low_f32x4 (v128.load64_zero offset=8 (local.get $v))))))
    (local.set $d (i32.add (local.get $d) (i32.const 4)))
    (br_if $col (i32.lt_u (local.get $d) (local.get $dim))))
   (f64.store (i32.add (local.get $out) (i32.shl (local.get $r) (i32.const 3)))
     (f64.add (f64.add (f64.add (f64x2.extract_lane 0 (local.get $a)) (f64x2.extract_lane 1 (local.get $a)))
       (f64x2.extract_lane 0 (local.get $b))) (f64x2.extract_lane 1 (local.get $b))))
   (local.set $r (i32.add (local.get $r) (i32.const 1))) (br $row))))
)
