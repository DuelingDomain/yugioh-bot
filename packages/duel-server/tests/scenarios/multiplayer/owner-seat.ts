import type { Scenario } from "../../support/dsl.js";
export interface SeatProof { scenario: Scenario; exactDecks?: boolean; watch?: string; actor?: number; target?: number; stolen?: {card: string; owner: number; controller: number}; banish?: number[]; }
export const OWNER_SEAT_PROOFS: SeatProof[] = [
  {
    "scenario": {
      "id": "owner-seat-destination-24649931-ffa3-p0",
      "title": "Materialization acts on and summons for the real owner",
      "source": "ADR-0002 real destination",
      "setup": {
        "format": "ffa3",
        "p0": {
          "spells": [
            {
              "card": "Materialization",
              "pos": "set"
            }
          ]
        },
        "p1": {},
        "p2": {
          "spells": [
            {
              "card": "Celtic Guardian",
              "pos": "up"
            }
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Materialization",
          "by": "p0"
        },
        {
          "op": "choose",
          "match": "Special Summon"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "lp": 8000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [
                "Materialization"
              ],
              "banished": [],
              "deckCount": 20
            },
            "p1": {
              "lp": 8000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "deckCount": 20
            },
            "p2": {
              "lp": 8000,
              "hand": [],
              "monsters": [
                "Celtic Guardian"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "deckCount": 20
            }
          }
        }
      ],
      "tags": [
        "multiplayer",
        "owner-seat",
        "stock-standard-opening-draw"
      ]
    },
    "watch": "Celtic Guardian",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "owner-seat-destination-24649931-ffa4-p0",
      "title": "Materialization acts on and summons for the real owner",
      "source": "ADR-0002 real destination",
      "setup": {
        "format": "ffa4",
        "p0": {
          "spells": [
            {
              "card": "Materialization",
              "pos": "set"
            }
          ]
        },
        "p1": {},
        "p2": {},
        "p3": {
          "spells": [
            {
              "card": "Celtic Guardian",
              "pos": "up"
            }
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Materialization",
          "by": "p0"
        },
        {
          "op": "choose",
          "match": "Special Summon"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "lp": 8000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [
                "Materialization"
              ],
              "banished": [],
              "deckCount": 20
            },
            "p1": {
              "lp": 8000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "deckCount": 20
            },
            "p2": {
              "lp": 8000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "deckCount": 20
            },
            "p3": {
              "lp": 8000,
              "hand": [],
              "monsters": [
                "Celtic Guardian"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "deckCount": 20
            }
          }
        }
      ],
      "tags": [
        "multiplayer",
        "owner-seat",
        "stock-standard-opening-draw"
      ]
    },
    "watch": "Celtic Guardian",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "owner-seat-destination-24649931-tag-p0",
      "title": "Materialization acts on and summons for the real owner",
      "source": "ADR-0002 real destination",
      "setup": {
        "format": "tag",
        "p0": {
          "spells": [
            {
              "card": "Materialization",
              "pos": "set"
            }
          ]
        },
        "p1": {},
        "p2": {
          "spells": [
            {
              "card": "Celtic Guardian",
              "pos": "up"
            }
          ]
        },
        "p3": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Materialization",
          "by": "p0"
        },
        {
          "op": "choose",
          "match": "Special Summon"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "lp": 16000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [
                "Materialization"
              ],
              "banished": [],
              "deckCount": 20
            },
            "p1": {
              "lp": 16000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "deckCount": 20
            },
            "p2": {
              "lp": 16000,
              "hand": [],
              "monsters": [
                "Celtic Guardian"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "deckCount": 20
            },
            "p3": {
              "lp": 16000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "deckCount": 20
            }
          }
        }
      ],
      "tags": [
        "multiplayer",
        "owner-seat"
      ]
    }
  },
  {
    "scenario": {
      "id": "owner-seat-destination-24649931-tag-p1",
      "title": "Materialization acts on and summons for the real owner",
      "source": "ADR-0002 real destination",
      "setup": {
        "format": "tag",
        "p0": {},
        "p1": {
          "spells": [
            {
              "card": "Materialization",
              "pos": "set"
            }
          ]
        },
        "p2": {},
        "p3": {
          "spells": [
            {
              "card": "Celtic Guardian",
              "pos": "up"
            }
          ]
        }
      },
      "steps": [
        {
          "op": "phase",
          "to": "end",
          "by": "p0"
        },
        {
          "op": "activate",
          "sel": "Materialization",
          "by": "p1"
        },
        {
          "op": "choose",
          "match": "Special Summon"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "lp": 16000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "deckCount": 20
            },
            "p1": {
              "lp": 16000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [
                "Materialization"
              ],
              "banished": [],
              "deckCount": 20
            },
            "p2": {
              "lp": 16000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "deckCount": 20
            },
            "p3": {
              "lp": 16000,
              "hand": [],
              "monsters": [
                "Celtic Guardian"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "deckCount": 20
            }
          }
        }
      ],
      "tags": [
        "multiplayer",
        "owner-seat"
      ]
    }
  },
  {
    "scenario": {
      "id": "materialization-stolen-ffa3",
      "title": "Materialization returns stolen equip owner",
      "source": "DECISIONS Owner decisions 2026-10-02 YOUR OPPONENT; R-FFA-OPP-ONE applies to opponent text only; R-COMMON-ALL-BOTH and R-COMMON-OPP-PICK informational hints",
      "setup": {
        "format": "ffa3",
        "attackFirstTurn": true,
        "p0": {
          "monsters": [
            "Relinquished"
          ],
          "spells": [
            {
              "card": "Materialization",
              "pos": "set"
            }
          ]
        },
        "p2": {
          "monsters": [
            "Mystical Elf"
          ]
        },
        "p1": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Relinquished",
          "by": "p0"
        },
        {
          "op": "activate",
          "sel": "Materialization",
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "title": "Select an option"
          }
        },
        {
          "op": "choose",
          "match": "Special Summon",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Relinquished"
              ],
              "spells": [],
              "grave": [
                "Materialization"
              ],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 20
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 20
            },
            "p2": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 20
            }
          }
        }
      ],
      "tags": [
        "multiplayer",
        "owner-seat",
        "stock-standard-opening-draw"
      ]
    }
  },
  {
    "scenario": {
      "id": "materialization-stolen-ffa4",
      "title": "Materialization returns stolen equip owner",
      "source": "DECISIONS Owner decisions 2026-10-02 YOUR OPPONENT; R-FFA-OPP-ONE applies to opponent text only; R-COMMON-ALL-BOTH and R-COMMON-OPP-PICK informational hints",
      "setup": {
        "format": "ffa4",
        "attackFirstTurn": true,
        "p0": {
          "monsters": [
            "Relinquished"
          ],
          "spells": [
            {
              "card": "Materialization",
              "pos": "set"
            }
          ]
        },
        "p3": {
          "monsters": [
            "Mystical Elf"
          ]
        },
        "p1": {},
        "p2": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Relinquished",
          "by": "p0"
        },
        {
          "op": "activate",
          "sel": "Materialization",
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "title": "Select an option"
          }
        },
        {
          "op": "choose",
          "match": "Special Summon",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Relinquished"
              ],
              "spells": [],
              "grave": [
                "Materialization"
              ],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 20
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 20
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 20
            },
            "p3": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 20
            }
          }
        }
      ],
      "tags": [
        "multiplayer",
        "owner-seat",
        "stock-standard-opening-draw"
      ]
    }
  },
  {
    "scenario": {
      "id": "materialization-stolen-tag",
      "title": "Materialization returns stolen equip owner",
      "source": "DECISIONS Owner decisions 2026-10-02 YOUR OPPONENT; R-FFA-OPP-ONE applies to opponent text only; R-COMMON-ALL-BOTH and R-COMMON-OPP-PICK informational hints",
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "monsters": [
            "Relinquished"
          ],
          "spells": [
            {
              "card": "Materialization",
              "pos": "set"
            }
          ]
        },
        "p3": {
          "monsters": [
            "Mystical Elf"
          ]
        },
        "p1": {},
        "p2": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Relinquished",
          "by": "p0"
        },
        {
          "op": "activate",
          "sel": "Materialization",
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "title": "Select an option"
          }
        },
        {
          "op": "choose",
          "match": "Special Summon",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Relinquished"
              ],
              "spells": [],
              "grave": [
                "Materialization"
              ],
              "banished": [],
              "lp": 16000,
              "hand": [],
              "deckCount": 20
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000,
              "hand": [],
              "deckCount": 20
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000,
              "hand": [],
              "deckCount": 20
            },
            "p3": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000,
              "hand": [],
              "deckCount": 20
            }
          }
        }
      ],
      "tags": [
        "multiplayer",
        "owner-seat"
      ]
    }
  },
  {
    "scenario": {
      "id": "fork-stolen-tag",
      "title": "Fork checks stolen Tag card owner Deck",
      "source": "DECISIONS Q5: one picked/bound opponent chooses in FFA and Tag; afternoon return-to-real-owner decision",
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Creature Swap"
          ],
          "spells": [
            {
              "card": "Mimighoul Fork",
              "pos": "set"
            }
          ],
          "deck": [
            "Mystical Elf",
            "Mystical Elf",
            "Mystical Elf",
            "Mystical Elf"
          ]
        },
        "p1": {
          "monsters": [
            {
              "card": "Celtic Guardian",
              "pos": "set"
            }
          ],
          "deck": [
            "Mystical Elf",
            "Mystical Elf",
            "Mystical Elf",
            "Mystical Elf"
          ]
        },
        "p2": {
          "hand": [
            "Pot of Greed"
          ],
          "monsters": [
            {
              "card": "Battle Ox",
              "pos": "set"
            }
          ],
          "deck": [
            "Mystical Elf",
            "Mystical Elf",
            "Mystical Elf"
          ]
        },
        "p3": {
          "monsters": [
            {
              "card": "Mystical Elf",
              "pos": "set"
            }
          ],
          "deck": [
            "Mystical Elf",
            "Mystical Elf",
            "Mystical Elf",
            "Mystical Elf"
          ]
        },
        "deckSize": 4
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Creature Swap",
          "by": "p0"
        },
        {
          "op": "pickOpponent",
          "seat": "p1",
          "by": "p0"
        },
        {
          "op": "raw",
          "answer": {
            "selected": [
              "card:0"
            ]
          },
          "by": "p1"
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p0"
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p1"
        },
        {
          "op": "activate",
          "sel": "Pot of Greed",
          "by": "p2"
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p2"
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p3"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "deckCount": 3
            },
            "p1": {
              "deckCount": 3
            },
            "p2": {
              "deckCount": 0
            },
            "p3": {
              "deckCount": 3
            }
          }
        },
        {
          "op": "activate",
          "sel": "Mimighoul Fork",
          "by": "p0"
        },
        {
          "op": "raw",
          "answer": {
            "selected": [
              "card:0"
            ]
          },
          "by": "p0"
        },
        {
          "op": "pickOpponent",
          "seat": "p1",
          "by": "p0"
        },
        {
          "op": "choose",
          "match": "Attack",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Creature Swap",
                "Mimighoul Fork"
              ],
              "banished": [],
              "hand": {
                "count": 1
              },
              "lp": 16000,
              "deckCount": 3
            },
            "p1": {
              "monsters": [
                "Battle Ox"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": {
                "count": 1
              },
              "lp": 16000,
              "deckCount": 3
            },
            "p2": {
              "monsters": [
                "Celtic Guardian"
              ],
              "spells": [],
              "grave": [
                "Pot of Greed"
              ],
              "banished": [],
              "hand": {
                "count": 3
              },
              "deckCount": 0,
              "lp": 16000
            },
            "p3": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": {
                "count": 1
              },
              "lp": 16000,
              "deckCount": 3
            }
          }
        }
      ],
      "tags": [
        "multiplayer",
        "owner-seat"
      ]
    },
    "exactDecks": true
  },
  {
    "scenario": {
      "id": "owner-seat-tag-own-card-control",
      "title": "Tag keeps a return to the activating duelist",
      "source": "ADR-0002 real destination",
      "setup": {
        "format": "tag",
        "p0": {
          "spells": [
            {
              "card": "Materialization",
              "pos": "set"
            },
            {
              "card": "Celtic Guardian",
              "pos": "up"
            }
          ]
        },
        "p1": {},
        "p2": {},
        "p3": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Materialization",
          "by": "p0"
        },
        {
          "op": "choose",
          "match": "Special Summon"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "lp": 16000,
              "hand": [],
              "monsters": [
                "Celtic Guardian"
              ],
              "spells": [],
              "grave": [
                "Materialization"
              ],
              "banished": [],
              "deckCount": 20
            },
            "p1": {
              "lp": 16000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "deckCount": 20
            },
            "p2": {
              "lp": 16000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "deckCount": 20
            },
            "p3": {
              "lp": 16000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "deckCount": 20
            }
          }
        }
      ],
      "tags": [
        "multiplayer",
        "owner-seat"
      ]
    }
  },
  {
    "scenario": {
      "id": "hecahands-material-ffa3-p2-opponent-owned-elf",
      "title": "hecahands-material-ffa3-p2-opponent-owned-elf",
      "source": "DECISIONS-2026-10-01.md: owner answers 2026-10-02 (afternoon); real owner and exact seat",
      "tags": [
        "multiplayer",
        "ffa3",
        "owner-seat-fix",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa3",
        "attackFirstTurn": true,
        "p0": {
          "monsters": [
            "Battle Ox"
          ],
          "spells": [
            {
              "card": "Give and Take",
              "pos": "set"
            }
          ],
          "grave": [
            "Mystical Elf"
          ]
        },
        "p1": {},
        "p2": {
          "monsters": [
            "Hecahands Mankibuel"
          ],
          "hand": [
            "Hecahands Tartaros"
          ],
          "extra": [
            "Hecahands Dandalos"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Give and Take",
          "by": "p0"
        },
        {
          "op": "pickOpponent",
          "seat": "p2",
          "by": "p0"
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p0"
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p1"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Battle Ox"
              ],
              "spells": [],
              "grave": [
                "Give and Take"
              ],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "extra": [],
              "deckCount": 20
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000,
              "hand": [
                "Mystical Elf"
              ],
              "extra": [],
              "deckCount": 19
            },
            "p2": {
              "monsters": [
                "Hecahands Mankibuel",
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000,
              "hand": [
                "Hecahands Tartaros",
                "Mystical Elf"
              ],
              "extra": [
                "Hecahands Dandalos"
              ],
              "deckCount": 19
            }
          }
        },
        {
          "op": "activate",
          "sel": "Hecahands Tartaros",
          "by": "p2"
        },
        {
          "op": "select",
          "sels": [
            "Hecahands Mankibuel",
            "Mystical Elf"
          ],
          "by": "p2"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Battle Ox"
              ],
              "spells": [],
              "grave": [
                "Give and Take"
              ],
              "banished": [
                "Mystical Elf"
              ],
              "lp": 8000,
              "hand": [],
              "extra": [],
              "deckCount": 20
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000,
              "hand": [
                "Mystical Elf"
              ],
              "extra": [],
              "deckCount": 19
            },
            "p2": {
              "monsters": [
                "Hecahands Dandalos"
              ],
              "spells": [],
              "grave": [
                "Hecahands Tartaros"
              ],
              "banished": [
                "Hecahands Mankibuel"
              ],
              "lp": 8000,
              "hand": [
                "Mystical Elf"
              ],
              "extra": [],
              "deckCount": 19
            }
          }
        }
      ]
    }
  },
  {
    "scenario": {
      "id": "hecahands-material-ffa4-p3-opponent-owned-elf",
      "title": "hecahands-material-ffa4-p3-opponent-owned-elf",
      "source": "DECISIONS-2026-10-01.md: owner answers 2026-10-02 (afternoon); real owner and exact seat",
      "tags": [
        "multiplayer",
        "ffa4",
        "owner-seat-fix",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa4",
        "attackFirstTurn": true,
        "p0": {
          "monsters": [
            "Battle Ox"
          ],
          "spells": [
            {
              "card": "Give and Take",
              "pos": "set"
            }
          ],
          "grave": [
            "Mystical Elf"
          ]
        },
        "p1": {},
        "p2": {},
        "p3": {
          "monsters": [
            "Hecahands Mankibuel"
          ],
          "hand": [
            "Hecahands Tartaros"
          ],
          "extra": [
            "Hecahands Dandalos"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Give and Take",
          "by": "p0"
        },
        {
          "op": "pickOpponent",
          "seat": "p3",
          "by": "p0"
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p0"
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p1"
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p2"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Battle Ox"
              ],
              "spells": [],
              "grave": [
                "Give and Take"
              ],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "extra": [],
              "deckCount": 20
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000,
              "hand": [
                "Mystical Elf"
              ],
              "extra": [],
              "deckCount": 19
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000,
              "hand": [
                "Mystical Elf"
              ],
              "extra": [],
              "deckCount": 19
            },
            "p3": {
              "monsters": [
                "Hecahands Mankibuel",
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000,
              "hand": [
                "Hecahands Tartaros",
                "Mystical Elf"
              ],
              "extra": [
                "Hecahands Dandalos"
              ],
              "deckCount": 19
            }
          }
        },
        {
          "op": "activate",
          "sel": "Hecahands Tartaros",
          "by": "p3"
        },
        {
          "op": "select",
          "sels": [
            "Hecahands Mankibuel",
            "Mystical Elf"
          ],
          "by": "p3"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Battle Ox"
              ],
              "spells": [],
              "grave": [
                "Give and Take"
              ],
              "banished": [
                "Mystical Elf"
              ],
              "lp": 8000,
              "hand": [],
              "extra": [],
              "deckCount": 20
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000,
              "hand": [
                "Mystical Elf"
              ],
              "extra": [],
              "deckCount": 19
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000,
              "hand": [
                "Mystical Elf"
              ],
              "extra": [],
              "deckCount": 19
            },
            "p3": {
              "monsters": [
                "Hecahands Dandalos"
              ],
              "spells": [],
              "grave": [
                "Hecahands Tartaros"
              ],
              "banished": [
                "Hecahands Mankibuel"
              ],
              "lp": 8000,
              "hand": [
                "Mystical Elf"
              ],
              "extra": [],
              "deckCount": 19
            }
          }
        }
      ]
    }
  },
  {
    "scenario": {
      "id": "hecahands-material-tag-p3-opponent-owned-elf",
      "title": "hecahands-material-tag-p3-opponent-owned-elf",
      "source": "DECISIONS-2026-10-01.md: owner answers 2026-10-02 (afternoon); real owner and exact seat",
      "tags": [
        "multiplayer",
        "tag",
        "owner-seat-fix"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "monsters": [
            "Battle Ox"
          ],
          "spells": [
            {
              "card": "Give and Take",
              "pos": "set"
            }
          ],
          "grave": [
            "Mystical Elf"
          ]
        },
        "p1": {},
        "p2": {},
        "p3": {
          "monsters": [
            "Hecahands Mankibuel"
          ],
          "hand": [
            "Hecahands Tartaros"
          ],
          "extra": [
            "Hecahands Dandalos"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Give and Take",
          "by": "p0"
        },
        {
          "op": "pickOpponent",
          "seat": "p3",
          "by": "p0"
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p0"
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p1"
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p2"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Battle Ox"
              ],
              "spells": [],
              "grave": [
                "Give and Take"
              ],
              "banished": [],
              "lp": 16000,
              "hand": [],
              "extra": [],
              "deckCount": 20
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000,
              "hand": [
                "Mystical Elf"
              ],
              "extra": [],
              "deckCount": 19
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000,
              "hand": [
                "Mystical Elf"
              ],
              "extra": [],
              "deckCount": 19
            },
            "p3": {
              "monsters": [
                "Hecahands Mankibuel",
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000,
              "hand": [
                "Hecahands Tartaros",
                "Mystical Elf"
              ],
              "extra": [
                "Hecahands Dandalos"
              ],
              "deckCount": 19
            }
          }
        },
        {
          "op": "activate",
          "sel": "Hecahands Tartaros",
          "by": "p3"
        },
        {
          "op": "select",
          "sels": [
            "Hecahands Mankibuel",
            "Mystical Elf"
          ],
          "by": "p3"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Battle Ox"
              ],
              "spells": [],
              "grave": [
                "Give and Take"
              ],
              "banished": [
                "Mystical Elf"
              ],
              "lp": 16000,
              "hand": [],
              "extra": [],
              "deckCount": 20
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000,
              "hand": [
                "Mystical Elf"
              ],
              "extra": [],
              "deckCount": 19
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000,
              "hand": [
                "Mystical Elf"
              ],
              "extra": [],
              "deckCount": 19
            },
            "p3": {
              "monsters": [
                "Hecahands Dandalos"
              ],
              "spells": [],
              "grave": [
                "Hecahands Tartaros"
              ],
              "banished": [
                "Hecahands Mankibuel"
              ],
              "lp": 16000,
              "hand": [
                "Mystical Elf"
              ],
              "extra": [],
              "deckCount": 19
            }
          }
        }
      ]
    }
  },
  {
    "scenario": {
      "id": "hecahands-material-tag-negative-partner",
      "title": "Control: Hecahands rejects a partner-owned material",
      "source": "DECISIONS-2026-10-01.md: owner answers 2026-10-02 (afternoon); real owner and exact seat",
      "tags": [
        "multiplayer",
        "tag",
        "owner-seat-fix",
        "control"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {},
        "p1": {},
        "p2": {},
        "p3": {
          "monsters": [
            "Hecahands Mankibuel",
            "Mystical Elf"
          ],
          "hand": [
            "Hecahands Tartaros"
          ],
          "extra": [
            "Hecahands Dandalos"
          ]
        }
      },
      "steps": [
        {
          "op": "phase",
          "to": "end",
          "by": "p0"
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p1"
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p2"
        },
        {
          "op": "expectNotOffered",
          "by": "p3",
          "action": "activate",
          "sel": "Hecahands Tartaros"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000,
              "hand": [],
              "deckCount": 20
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000,
              "hand": [
                "Mystical Elf"
              ],
              "deckCount": 19
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000,
              "hand": [
                "Mystical Elf"
              ],
              "deckCount": 19
            },
            "p3": {
              "monsters": [
                "Hecahands Mankibuel",
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000,
              "hand": [
                "Hecahands Tartaros",
                "Mystical Elf"
              ],
              "extra": [
                "Hecahands Dandalos"
              ],
              "deckCount": 19
            }
          }
        }
      ]
    },
    "stolen": {
      "card": "Mystical Elf",
      "owner": 1,
      "controller": 3
    }
  },
  {
    "scenario": {
      "id": "fork-stolen-ffa3-flip",
      "title": "fork-stolen-ffa3-flip",
      "source": "DECISIONS Q5: one picked/bound opponent chooses in FFA and Tag; afternoon return-to-real-owner decision",
      "tags": [
        "multiplayer",
        "ffa3",
        "owner-seat-fix",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa3",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            {
              "card": "Mimighoul Fork",
              "pos": "set"
            }
          ]
        },
        "p1": {
          "monsters": [
            {
              "card": "Battle Ox",
              "pos": "set"
            }
          ]
        },
        "p2": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Mimighoul Fork",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "label": "Change it"
            },
            {
              "label": "Send"
            }
          ],
          "by": "p1"
        },
        {
          "op": "choose",
          "match": "Change it",
          "by": "p1"
        },
        {
          "op": "choose",
          "match": "Attack",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Mimighoul Fork"
              ],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 20
            },
            "p1": {
              "monsters": [
                "Battle Ox"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 20
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000,
              "hand": {
                "count": 0
              },
              "deckCount": 20
            }
          }
        }
      ]
    },
    "stolen": {
      "card": "Battle Ox",
      "owner": 2,
      "controller": 1
    }
  },
  {
    "scenario": {
      "id": "fork-stolen-ffa3-send-draw",
      "title": "fork-stolen-ffa3-send-draw",
      "source": "DECISIONS Q5: one picked/bound opponent chooses in FFA and Tag; afternoon return-to-real-owner decision",
      "tags": [
        "multiplayer",
        "ffa3",
        "owner-seat-fix",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa3",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            {
              "card": "Mimighoul Fork",
              "pos": "set"
            }
          ]
        },
        "p1": {
          "monsters": [
            {
              "card": "Battle Ox",
              "pos": "set"
            }
          ]
        },
        "p2": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Mimighoul Fork",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "label": "Change it"
            },
            {
              "label": "Send"
            }
          ],
          "by": "p1"
        },
        {
          "op": "choose",
          "match": "Send",
          "by": "p1"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Mimighoul Fork"
              ],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 20
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 20
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Battle Ox"
              ],
              "banished": [],
              "lp": 8000,
              "hand": {
                "count": 2
              },
              "deckCount": 18
            }
          }
        }
      ]
    },
    "stolen": {
      "card": "Battle Ox",
      "owner": 2,
      "controller": 1
    }
  },
  {
    "scenario": {
      "id": "fork-stolen-ffa4-flip",
      "title": "fork-stolen-ffa4-flip",
      "source": "DECISIONS Q5: one picked/bound opponent chooses in FFA and Tag; afternoon return-to-real-owner decision",
      "tags": [
        "multiplayer",
        "ffa4",
        "owner-seat-fix",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa4",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            {
              "card": "Mimighoul Fork",
              "pos": "set"
            }
          ]
        },
        "p1": {
          "monsters": [
            {
              "card": "Battle Ox",
              "pos": "set"
            }
          ]
        },
        "p2": {},
        "p3": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Mimighoul Fork",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "label": "Change it"
            },
            {
              "label": "Send"
            }
          ],
          "by": "p1"
        },
        {
          "op": "choose",
          "match": "Change it",
          "by": "p1"
        },
        {
          "op": "choose",
          "match": "Attack",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Mimighoul Fork"
              ],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 20
            },
            "p1": {
              "monsters": [
                "Battle Ox"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 20
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000,
              "hand": {
                "count": 0
              },
              "deckCount": 20
            },
            "p3": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 20
            }
          }
        }
      ]
    },
    "stolen": {
      "card": "Battle Ox",
      "owner": 2,
      "controller": 1
    }
  },
  {
    "scenario": {
      "id": "fork-stolen-ffa4-send-draw",
      "title": "fork-stolen-ffa4-send-draw",
      "source": "DECISIONS Q5: one picked/bound opponent chooses in FFA and Tag; afternoon return-to-real-owner decision",
      "tags": [
        "multiplayer",
        "ffa4",
        "owner-seat-fix",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa4",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            {
              "card": "Mimighoul Fork",
              "pos": "set"
            }
          ]
        },
        "p1": {
          "monsters": [
            {
              "card": "Battle Ox",
              "pos": "set"
            }
          ]
        },
        "p2": {},
        "p3": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Mimighoul Fork",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "label": "Change it"
            },
            {
              "label": "Send"
            }
          ],
          "by": "p1"
        },
        {
          "op": "choose",
          "match": "Send",
          "by": "p1"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Mimighoul Fork"
              ],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 20
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 20
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Battle Ox"
              ],
              "banished": [],
              "lp": 8000,
              "hand": {
                "count": 2
              },
              "deckCount": 18
            },
            "p3": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 20
            }
          }
        }
      ]
    },
    "stolen": {
      "card": "Battle Ox",
      "owner": 2,
      "controller": 1
    }
  },
  {
    "scenario": {
      "id": "materialization-two-opponents-ffa3",
      "title": "Materialization acts on and summons for the real owner",
      "source": "DECISIONS Owner decisions 2026-10-02 YOUR OPPONENT; R-FFA-OPP-ONE applies to opponent text only; R-COMMON-ALL-BOTH and R-COMMON-OPP-PICK informational hints",
      "setup": {
        "format": "ffa3",
        "p0": {
          "spells": [
            {
              "card": "Materialization",
              "pos": "set"
            }
          ]
        },
        "p1": {
          "spells": [
            {
              "card": "Battle Ox",
              "pos": "up"
            }
          ]
        },
        "p2": {
          "spells": [
            {
              "card": "Celtic Guardian",
              "pos": "up"
            }
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Materialization",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "seat": "p1",
              "card": "Battle Ox"
            },
            {
              "seat": "p2",
              "card": "Celtic Guardian"
            }
          ],
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            {
              "card": "Celtic Guardian",
              "owner": "p2"
            }
          ],
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "title": "Select an option"
          }
        },
        {
          "op": "choose",
          "match": "Special Summon"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "lp": 8000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [
                "Materialization"
              ],
              "banished": [],
              "deckCount": 20
            },
            "p1": {
              "lp": 8000,
              "hand": [],
              "monsters": [],
              "spells": [
                "Battle Ox"
              ],
              "grave": [],
              "banished": [],
              "deckCount": 20
            },
            "p2": {
              "lp": 8000,
              "hand": [],
              "monsters": [
                "Celtic Guardian"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "deckCount": 20
            }
          }
        }
      ],
      "tags": [
        "multiplayer",
        "owner-seat",
        "stock-standard-opening-draw"
      ]
    }
  },
  {
    "scenario": {
      "id": "materialization-two-opponents-ffa4",
      "title": "Materialization acts on and summons for the real owner",
      "source": "DECISIONS Owner decisions 2026-10-02 YOUR OPPONENT; R-FFA-OPP-ONE applies to opponent text only; R-COMMON-ALL-BOTH and R-COMMON-OPP-PICK informational hints",
      "setup": {
        "format": "ffa4",
        "p0": {
          "spells": [
            {
              "card": "Materialization",
              "pos": "set"
            }
          ]
        },
        "p1": {
          "spells": [
            {
              "card": "Battle Ox",
              "pos": "up"
            }
          ]
        },
        "p2": {},
        "p3": {
          "spells": [
            {
              "card": "Celtic Guardian",
              "pos": "up"
            }
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Materialization",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "seat": "p1",
              "card": "Battle Ox"
            },
            {
              "seat": "p3",
              "card": "Celtic Guardian"
            }
          ],
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            {
              "card": "Celtic Guardian",
              "owner": "p3"
            }
          ],
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "title": "Select an option"
          }
        },
        {
          "op": "choose",
          "match": "Special Summon"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "lp": 8000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [
                "Materialization"
              ],
              "banished": [],
              "deckCount": 20
            },
            "p1": {
              "lp": 8000,
              "hand": [],
              "monsters": [],
              "spells": [
                "Battle Ox"
              ],
              "grave": [],
              "banished": [],
              "deckCount": 20
            },
            "p2": {
              "lp": 8000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "deckCount": 20
            },
            "p3": {
              "lp": 8000,
              "hand": [],
              "monsters": [
                "Celtic Guardian"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "deckCount": 20
            }
          }
        }
      ],
      "tags": [
        "multiplayer",
        "owner-seat",
        "stock-standard-opening-draw"
      ]
    }
  },
  {
    "scenario": {
      "id": "materialization-two-opponents-tag",
      "title": "Materialization acts on and summons for the real owner",
      "source": "DECISIONS Owner decisions 2026-10-02 YOUR OPPONENT; R-FFA-OPP-ONE applies to opponent text only; R-COMMON-ALL-BOTH and R-COMMON-OPP-PICK informational hints",
      "setup": {
        "format": "tag",
        "p0": {
          "spells": [
            {
              "card": "Materialization",
              "pos": "set"
            }
          ]
        },
        "p1": {
          "spells": [
            {
              "card": "Battle Ox",
              "pos": "up"
            }
          ]
        },
        "p2": {},
        "p3": {
          "spells": [
            {
              "card": "Celtic Guardian",
              "pos": "up"
            }
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Materialization",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "seat": "p1",
              "card": "Battle Ox"
            },
            {
              "seat": "p3",
              "card": "Celtic Guardian"
            }
          ],
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            {
              "card": "Celtic Guardian",
              "owner": "p3"
            }
          ],
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "title": "Select an option"
          }
        },
        {
          "op": "choose",
          "match": "Special Summon"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "lp": 16000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [
                "Materialization"
              ],
              "banished": [],
              "deckCount": 20
            },
            "p1": {
              "lp": 16000,
              "hand": [],
              "monsters": [],
              "spells": [
                "Battle Ox"
              ],
              "grave": [],
              "banished": [],
              "deckCount": 20
            },
            "p2": {
              "lp": 16000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "deckCount": 20
            },
            "p3": {
              "lp": 16000,
              "hand": [],
              "monsters": [
                "Celtic Guardian"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "deckCount": 20
            }
          }
        }
      ],
      "tags": [
        "multiplayer",
        "owner-seat"
      ]
    }
  },
  {
    "scenario": {
      "id": "fork-stolen-tag-send-draw",
      "title": "fork-stolen-ffa4-send-draw",
      "source": "DECISIONS Q5: one picked/bound opponent chooses in FFA and Tag; afternoon return-to-real-owner decision",
      "tags": [
        "multiplayer",
        "ffa4",
        "owner-seat-fix"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            {
              "card": "Mimighoul Fork",
              "pos": "set"
            }
          ]
        },
        "p1": {
          "monsters": [
            {
              "card": "Battle Ox",
              "pos": "set"
            }
          ]
        },
        "p2": {},
        "p3": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Mimighoul Fork",
          "by": "p0"
        },
        {
          "op": "pickOpponent",
          "seat": "p1",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "label": "Change it"
            },
            {
              "label": "Send"
            }
          ],
          "by": "p1"
        },
        {
          "op": "choose",
          "match": "Send",
          "by": "p1"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Mimighoul Fork"
              ],
              "banished": [],
              "lp": 16000,
              "hand": [],
              "deckCount": 20
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000,
              "hand": [],
              "deckCount": 20
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Battle Ox"
              ],
              "banished": [],
              "lp": 16000,
              "hand": {
                "count": 2
              },
              "deckCount": 18
            },
            "p3": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000,
              "hand": [],
              "deckCount": 20
            }
          }
        }
      ]
    },
    "stolen": {
      "card": "Battle Ox",
      "owner": 2,
      "controller": 1
    }
  }
];
