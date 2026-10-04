import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("parallel_emxx", Path(__file__).with_name("parallel-emxx.py"))
emxx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(emxx)


class CompileCommands(unittest.TestCase):
    def test_keeps_flags_and_link_input_order(self):
        flags = ["-Os", "-g0", "--closure", "1", "-sMODULARIZE=1", "-fwasm-exceptions", "-I./cpp/lua", "-Dluai_makeseed()=0u"]
        sources = ["./cpp/lua/lapi.c", "./cpp/ygo/card.cpp", "./cpp/wasm.cpp"]
        commands, link = emxx.commands(flags + sources + ["-o", "lib/core.mjs"], "/objects", "/real/em++")
        self.assertEqual(len(commands), 3)
        for index, source in enumerate(sources):
            self.assertEqual(commands[index], ["/real/em++", *flags, "-c", source, "-o", f"/objects/{index}.o"])
        self.assertEqual(link, ["/real/em++", *flags, *[f"/objects/{index}.o" for index in range(3)], "-o", "lib/core.mjs"])

    def test_leaves_other_compiler_calls_alone(self):
        for args in [["--version"], ["-c", "card.cpp", "-o", "card.o"], ["@args.rsp"], ["-M", "card.cpp"]]:
            self.assertIsNone(emxx.commands(args, "/objects", "/real/em++"))


if __name__ == "__main__":
    unittest.main()
