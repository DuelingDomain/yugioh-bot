// Native check for the Lua overlay of duels with more than two seats (design F7 section 4, the harness in scripted-duel.h).
// It writes an overlay folder of its own into a temp folder and loads card scripts through Duel.LoadScript:
//   - at n = 3 with overlay=true: mp-utility.lua sets MP_OVERLAY_ACTIVE, a file that starts with --@replace replaces the
//     original script, any other file is appended to it, and a suffix for a card with no script gives no script at all
//   - a later duel with overlay=false in the same process (n = 2, then n = 3) reads the original scripts only
#include "scripted-duel.h"
#include <cstdlib>
#include <fstream>
#include <map>
#include <string>
#include <unistd.h>

static std::string last_value;

static std::string probe(OCG_Duel d, const std::string& expr) {
	last_value = "<no line>";
	sd::lua(d, "Debug.Message('CHK v='..tostring(" + expr + "))");
	return last_value;
}

static void write_file(const std::string& path, const std::string& text) {
	std::ofstream out(path, std::ios::binary);
	out << text;
}

// kReplaced has an original script and a --@replace file, kSuffixed an original and a suffix, kOrphan a suffix and no original.
static const uint32_t kReplaced = 100, kSuffixed = 200, kOrphan = 300;

static OCG_Duel duel_with_scripts(const std::string& setup, bool overlay) {
	sd::stray_logs = 0;
	sd::on_line = [](const std::string& line) { last_value = line.substr(6); };  // "CHK v=" is 6 characters
	sd::scripts.clear();
	sd::scripts[kReplaced] = "MP_SCRIPT_100='orig'\n";
	sd::scripts[kSuffixed] = "MP_SCRIPT_200='orig'";   // no final new line: the suffix must start a new line
	OCG_Duel d = sd::create(setup, 1, overlay);
	for(uint32_t code : { kReplaced, kSuffixed, kOrphan })
		sd::lua(d, "Duel.LoadScript('c" + std::to_string(code) + ".lua')");
	return d;
}

int main() {
	std::string templ = check_tmp_template("mp-overlay");
	if(!mkdtemp(templ.data())) { std::printf("FAIL: mkdtemp\n"); return 2; }
	const std::string dir = templ;
	write_file(dir + "/mp-utility.lua", "MP_OVERLAY_ACTIVE = true\n");
	write_file(dir + "/c100.lua", "--@replace\nMP_SCRIPT_100='replaced'\n");
	write_file(dir + "/c200.lua", "MP_SCRIPT_200=MP_SCRIPT_200..'+suffix'\n");
	write_file(dir + "/c300.lua", "MP_SCRIPT_300='orphan suffix'\n");
	setenv("CHECK_MULTI_SCRIPTS", dir.c_str(), 1);

	{ // n = 3, overlay on
		OCG_Duel d = duel_with_scripts("Debug.SetupDuelists(3,0,1,2)", true);
		EXPECT(probe(d, "MP_OVERLAY_ACTIVE") == "true", "n3: MP_OVERLAY_ACTIVE is %s, want true", last_value.c_str());
		EXPECT(probe(d, "MP_SCRIPT_100") == "replaced", "n3: the replaced card reads %s, want replaced", last_value.c_str());
		EXPECT(probe(d, "MP_SCRIPT_200") == "orig+suffix", "n3: the suffixed card reads %s, want orig+suffix", last_value.c_str());
		EXPECT(probe(d, "MP_SCRIPT_300") == "nil", "n3: a suffix for a card with no script gave a script (%s)", last_value.c_str());
		OCG_DestroyDuel(d);
		std::printf("ok   n3 overlay\n");
	}
	{ // n = 2 in the same process: the overlay of the duel before must not stay on
		OCG_Duel d = duel_with_scripts("", false);
		EXPECT(probe(d, "MP_OVERLAY_ACTIVE") == "nil", "n2: MP_OVERLAY_ACTIVE is %s, want nil", last_value.c_str());
		EXPECT(probe(d, "MP_SCRIPT_100") == "orig", "n2: the card reads %s, want orig", last_value.c_str());
		EXPECT(probe(d, "MP_SCRIPT_200") == "orig", "n2: the card reads %s, want orig", last_value.c_str());
		EXPECT(probe(d, "MP_SCRIPT_300") == "nil", "n2: card 300 gave a script (%s)", last_value.c_str());
		OCG_DestroyDuel(d);
		std::printf("ok   n2 after an overlay duel\n");
	}
	{ // n = 3 without the overlay flag: the checks that never ask for it keep the stock scripts
		OCG_Duel d = duel_with_scripts("Debug.SetupDuelists(3,0,1,2)", false);
		EXPECT(probe(d, "MP_OVERLAY_ACTIVE") == "nil", "n3 no overlay: MP_OVERLAY_ACTIVE is %s, want nil", last_value.c_str());
		EXPECT(probe(d, "MP_SCRIPT_100") == "orig", "n3 no overlay: the card reads %s, want orig", last_value.c_str());
		OCG_DestroyDuel(d);
		std::printf("ok   n3 without the overlay flag\n");
	}
	for(const char* name : { "mp-utility.lua", "c100.lua", "c200.lua", "c300.lua" }) unlink((dir + "/" + name).c_str());
	rmdir(dir.c_str());
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
