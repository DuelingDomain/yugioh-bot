// Shared helpers for the native rule checks in this folder. Every check includes this file.
// A check is one program: it plays real duels through the native multi-duelist core (OCG_* API plus the
// internal duel.h / field.h headers), counts EXPECT failures and exits 1 when there is one.
#pragma once
#include <cstdio>
#include <cstdlib>
#include <string>

// Number of failed EXPECT lines. Every check prints "PASS" or "FAIL ... N failure(s)" and exits with 0 or 1.
static int failures = 0;

#ifndef EXPECT
#define EXPECT(cond, ...) do { if(!(cond)) { ++failures; std::printf("FAIL %s:%d: ", __FILE__, __LINE__); std::printf(__VA_ARGS__); std::printf("\n"); } } while(0)
#endif

// Value of an environment variable, or the fallback when it is unset or empty.
[[maybe_unused]] static const char* check_env(const char* name, const char* fallback) {
	const char* v = std::getenv(name);
	return v && *v ? v : fallback;
}

// Card script folder. run.sh sets CHECK_SCRIPTS to <DUEL_DATA_DIR>/card-scripts. The fallback is relative to the repo root.
[[maybe_unused]] static const char* check_scripts_dir() {
	return check_env("CHECK_SCRIPTS", "data/duel-engine-next/card-scripts");
}

// Lua overlay folder of duels with more than two seats (mp-utility.lua, cNNN.lua suffixes). run.sh sets CHECK_MULTI_SCRIPTS.
// Only a check that asks for the overlay (sd::create(..., true) in scripted-duel.h) reads it. The fallback is relative to the repo root.
[[maybe_unused]] static const char* check_multi_scripts_dir() {
	return check_env("CHECK_MULTI_SCRIPTS", "packages/duel-server/domain-core/multi-scripts");
}

// Template for mkstemp: the checks catch the core's stderr log in a temp file. run.sh sets TMPDIR to its build folder.
[[maybe_unused]] static std::string check_tmp_template(const char* stem) {
	return std::string(check_env("TMPDIR", "/tmp")) + "/" + stem + "-XXXXXX";
}
