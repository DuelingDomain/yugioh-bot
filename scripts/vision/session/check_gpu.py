"""Read-only local GPU check: tiny matmul + optimizer step, no model downloads.

ROCm uses torch.cuda APIs on AMD too. --device directml checks the fallback in a
separate torch-directml environment. Failure exits 2; never silently trains on CPU.
"""
from __future__ import annotations
import argparse
import json
import platform
import time


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--device', choices=['rocm', 'directml', 'cpu'], default='rocm')
    p.add_argument('--steps', type=int, default=20)
    args = p.parse_args()
    if not 1 <= args.steps <= 1000:
        p.error('steps must be 1-1000')
    info = {'platform': platform.platform(), 'requested': args.device, 'ok': False}
    try:
        import torch
        info.update(torch=torch.__version__, hip=torch.version.hip)
        if args.device == 'rocm':
            if not torch.version.hip or not torch.cuda.is_available():
                raise RuntimeError('ROCm GPU not available; use the owner setup steps in LOCAL-TRAINING.md')
            device = torch.device('cuda')
            info.update(gpu=torch.cuda.get_device_name(0), vramGiB=round(torch.cuda.get_device_properties(0).total_memory / 2**30, 1))
            sync = torch.cuda.synchronize
        elif args.device == 'directml':
            import torch_directml
            device = torch_directml.device()
            info['gpu'] = torch_directml.device_name(0)
            sync = lambda: None  # .cpu().item() below is the synchronization fence.
        else:
            device = torch.device('cpu')
            info['gpu'] = 'CPU diagnostic only'
            sync = lambda: None
        torch.manual_seed(633)
        x = torch.randn(64, 128, device=device)
        weight = torch.randn(128, 128, device=device)
        sync()
        start = time.perf_counter()
        value = (x @ weight).square().mean().cpu().item()
        sync()
        info['matmulMs'] = (time.perf_counter() - start) * 1000
        if not 0 < value < 1e6:
            raise RuntimeError('Nonfinite/invalid matmul')
        model = torch.nn.Sequential(torch.nn.Linear(128, 128), torch.nn.ReLU(), torch.nn.Linear(128, 16)).to(device)
        opt = torch.optim.SGD(model.parameters(), lr=.01)
        target = torch.zeros(64, 16, device=device)
        def step():
            opt.zero_grad(set_to_none=True)
            loss = (model(x) - target).square().mean()
            loss.backward()
            opt.step()
            return loss.detach().cpu().item()
        step()  # kernel warm-up, excluded
        sync()
        start = time.perf_counter()
        for _ in range(args.steps):
            loss = step()
        sync()
        elapsed = time.perf_counter() - start
        info.update(ok=True, trainLoss=loss, iterationsPerSecond=args.steps / elapsed, steps=args.steps,
                    note='Tiny diagnostic throughput, not detector/DINO throughput. Run each trainer --bench for an ETA.')
    except Exception as e:
        info['error'] = str(e)
    print(json.dumps(info, indent=2))
    return 0 if info['ok'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
