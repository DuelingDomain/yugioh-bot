#ifndef DOMAIN_MASTER_H_
#define DOMAIN_MASTER_H_

#include <cstdint>
#include "common.h"

#ifndef LOCATION_DECKMASTER
#define LOCATION_DECKMASTER 0x4000
#endif
#ifndef LOCATION_DECKMASTER_RETURNS
#define LOCATION_DECKMASTER_RETURNS 0x8000
#endif

#define DOMAIN_RECALL_DESC 0x444D5243
#define DOMAIN_LEAVE_TAX_STEP 500
#define DOMAIN_RECALL_STEP 90

class card;
class effect;

bool domain_is_extra_type(const card* pcard);
bool domain_is_main_pendulum(const card* pcard);
uint32_t domain_leave_tax(uint32_t returns);

#endif
