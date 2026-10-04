#!/usr/bin/env python3
"""CI-only em++ adapter. Compile independent inputs concurrently; link in upstream order.

The pinned core build passes all sources to one em++ call, whose compiler phase is
serial. Keep every flag and the input order. Clean serial/parallel wasm hashes are
checked before changing this adapter. Other em++ invocations pass through unchanged.
"""
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory


def commands(args, directory, compiler):
    if any(arg in args for arg in ("-c", "-M", "-MM", "-E", "-S")) or any(arg.startswith("@") for arg in args):
        return None
    sources = [arg for arg in args if arg.endswith((".c", ".cpp", ".cc"))]
    if len(sources) < 2 or "-o" not in args:
        return None
    output_index = args.index("-o")
    output = args[output_index + 1]
    flags = [arg for index, arg in enumerate(args) if arg not in sources and index not in (output_index, output_index + 1)]
    objects = [str(Path(directory) / f"{index}.o") for index in range(len(sources))]
    compile_commands = [[compiler, *flags, "-c", source, "-o", obj] for source, obj in zip(sources, objects)]
    return compile_commands, [compiler, *flags, *objects, "-o", output]


def main():
    compiler = os.environ["CI_REAL_EMXX"]
    with TemporaryDirectory(prefix="ci-emxx-") as directory:
        plan = commands(sys.argv[1:], directory, compiler)
        if plan is None:
            return subprocess.call([compiler, *sys.argv[1:]])
        compile_commands, link = plan
        jobs = int(os.environ.get("EMCC_CORES", len(os.sched_getaffinity(0))))
        print(f"CI em++: {len(compile_commands)} inputs, {jobs} compiler jobs", flush=True)
        run = lambda command: subprocess.run(command, check=True)
        # Initialize the Emscripten sysroot/cache before starting concurrent drivers.
        run(compile_commands[0])
        with ThreadPoolExecutor(max_workers=jobs) as pool:
            list(pool.map(run, compile_commands[1:]))
        run(link)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode)
