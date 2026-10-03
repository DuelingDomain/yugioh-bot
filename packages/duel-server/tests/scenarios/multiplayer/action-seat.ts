import type { Scenario } from "../../support/dsl.js";
export interface SeatProof { scenario: Scenario; watch?: string; actor?: number; target?: number; stolen?: {card: string; owner: number; controller: number}; banish?: number[]; confirm?: boolean; }
export const ACTION_SEAT_PROOFS: SeatProof[] = [
  {
    "scenario": {
      "id": "local-controller-summons-11163040-ffa3",
      "title": "11163040: use the real card controller or owner for a summon",
      "source": "R-COMMON-OPP-PICK: this effect targets a Kaiju on the field and does not refer to an opponent; no opponent prompt",
      "tags": [
        "multiplayer",
        "ffa3",
        "card:11163040",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa3",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            "The Kaiju Files"
          ],
          "deck": [
            "Mystical Elf",
            "Gameciel, the Sea Turtle Kaiju",
            "Kumongous, the Sticky String Kaiju"
          ]
        },
        "p2": {
          "monsters": [
            "Dogoran, the Mad Flame Kaiju"
          ]
        },
        "p1": {
          "monsters": [
            "Dogoran, the Mad Flame Kaiju"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "The Kaiju Files",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "by": "p0",
          "options": [
            {
              "seat": "p1",
              "card": "Dogoran, the Mad Flame Kaiju"
            },
            {
              "seat": "p2",
              "card": "Dogoran, the Mad Flame Kaiju"
            }
          ]
        },
        {
          "op": "select",
          "by": "p0",
          "sels": [
            {
              "owner": "p2",
              "card": "Dogoran, the Mad Flame Kaiju"
            }
          ]
        },
        {
          "op": "expectPickOptions",
          "by": "p0",
          "options": [
            {
              "seat": "p0",
              "card": "Gameciel, the Sea Turtle Kaiju"
            },
            {
              "seat": "p0",
              "card": "Kumongous, the Sticky String Kaiju"
            }
          ]
        },
        {
          "op": "select",
          "by": "p0",
          "sels": [
            "Gameciel, the Sea Turtle Kaiju"
          ]
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [
                "The Kaiju Files"
              ],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [
                "Dogoran, the Mad Flame Kaiju"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [
                "Gameciel, the Sea Turtle Kaiju"
              ],
              "spells": [],
              "grave": [
                "Dogoran, the Mad Flame Kaiju"
              ],
              "banished": [],
              "hand": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Gameciel, the Sea Turtle Kaiju",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "local-controller-summons-11163040-ffa4",
      "title": "11163040: use the real card controller or owner for a summon",
      "source": "R-COMMON-OPP-PICK: this effect targets a Kaiju on the field and does not refer to an opponent; no opponent prompt",
      "tags": [
        "multiplayer",
        "ffa4",
        "card:11163040",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa4",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            "The Kaiju Files"
          ],
          "deck": [
            "Mystical Elf",
            "Gameciel, the Sea Turtle Kaiju",
            "Kumongous, the Sticky String Kaiju"
          ]
        },
        "p3": {
          "monsters": [
            "Dogoran, the Mad Flame Kaiju"
          ]
        },
        "p1": {
          "monsters": [
            "Dogoran, the Mad Flame Kaiju"
          ]
        },
        "p2": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "The Kaiju Files",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "by": "p0",
          "options": [
            {
              "seat": "p1",
              "card": "Dogoran, the Mad Flame Kaiju"
            },
            {
              "seat": "p3",
              "card": "Dogoran, the Mad Flame Kaiju"
            }
          ]
        },
        {
          "op": "select",
          "by": "p0",
          "sels": [
            {
              "owner": "p3",
              "card": "Dogoran, the Mad Flame Kaiju"
            }
          ]
        },
        {
          "op": "expectPickOptions",
          "by": "p0",
          "options": [
            {
              "seat": "p0",
              "card": "Gameciel, the Sea Turtle Kaiju"
            },
            {
              "seat": "p0",
              "card": "Kumongous, the Sticky String Kaiju"
            }
          ]
        },
        {
          "op": "select",
          "by": "p0",
          "sels": [
            "Gameciel, the Sea Turtle Kaiju"
          ]
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [
                "The Kaiju Files"
              ],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [
                "Dogoran, the Mad Flame Kaiju"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p3": {
              "monsters": [
                "Gameciel, the Sea Turtle Kaiju"
              ],
              "spells": [],
              "grave": [
                "Dogoran, the Mad Flame Kaiju"
              ],
              "banished": [],
              "hand": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Gameciel, the Sea Turtle Kaiju",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "local-controller-summons-11163040-tag",
      "title": "11163040: use the real card controller or owner for a summon",
      "source": "R-COMMON-OPP-PICK: this effect targets a Kaiju on the field and does not refer to an opponent; no opponent prompt",
      "tags": [
        "multiplayer",
        "tag",
        "card:11163040"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            "The Kaiju Files"
          ],
          "deck": [
            "Gameciel, the Sea Turtle Kaiju",
            "Kumongous, the Sticky String Kaiju"
          ]
        },
        "p3": {
          "monsters": [
            "Dogoran, the Mad Flame Kaiju"
          ]
        },
        "p1": {},
        "p2": {
          "monsters": [
            "Dogoran, the Mad Flame Kaiju"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "The Kaiju Files",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "by": "p0",
          "options": [
            {
              "seat": "p2",
              "card": "Dogoran, the Mad Flame Kaiju"
            },
            {
              "seat": "p3",
              "card": "Dogoran, the Mad Flame Kaiju"
            }
          ]
        },
        {
          "op": "select",
          "by": "p0",
          "sels": [
            {
              "owner": "p3",
              "card": "Dogoran, the Mad Flame Kaiju"
            }
          ]
        },
        {
          "op": "expectPickOptions",
          "by": "p0",
          "options": [
            {
              "seat": "p0",
              "card": "Gameciel, the Sea Turtle Kaiju"
            },
            {
              "seat": "p0",
              "card": "Kumongous, the Sticky String Kaiju"
            }
          ]
        },
        {
          "op": "select",
          "by": "p0",
          "sels": [
            "Gameciel, the Sea Turtle Kaiju"
          ]
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [
                "The Kaiju Files"
              ],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [
                "Dogoran, the Mad Flame Kaiju"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [
                "Gameciel, the Sea Turtle Kaiju"
              ],
              "spells": [],
              "grave": [
                "Dogoran, the Mad Flame Kaiju"
              ],
              "banished": [],
              "hand": [],
              "lp": 16000
            }
          }
        }
      ]
    },
    "watch": "Gameciel, the Sea Turtle Kaiju",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "local-controller-summons-11163040-tag-partner",
      "title": "11163040: use the real card controller or owner for a summon",
      "source": "R-COMMON-OPP-PICK: this effect targets a Kaiju on the field and does not refer to an opponent; no opponent prompt",
      "tags": [
        "multiplayer",
        "tag",
        "card:11163040"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            "The Kaiju Files"
          ],
          "deck": [
            "Gameciel, the Sea Turtle Kaiju",
            "Kumongous, the Sticky String Kaiju"
          ]
        },
        "p1": {},
        "p2": {
          "monsters": [
            "Dogoran, the Mad Flame Kaiju"
          ]
        },
        "p3": {
          "monsters": [
            "Dogoran, the Mad Flame Kaiju"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "The Kaiju Files",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "by": "p0",
          "options": [
            {
              "seat": "p3",
              "card": "Dogoran, the Mad Flame Kaiju"
            },
            {
              "seat": "p2",
              "card": "Dogoran, the Mad Flame Kaiju"
            }
          ]
        },
        {
          "op": "select",
          "by": "p0",
          "sels": [
            {
              "owner": "p2",
              "card": "Dogoran, the Mad Flame Kaiju"
            }
          ]
        },
        {
          "op": "expectPickOptions",
          "by": "p0",
          "options": [
            {
              "seat": "p0",
              "card": "Gameciel, the Sea Turtle Kaiju"
            },
            {
              "seat": "p0",
              "card": "Kumongous, the Sticky String Kaiju"
            }
          ]
        },
        {
          "op": "select",
          "by": "p0",
          "sels": [
            "Gameciel, the Sea Turtle Kaiju"
          ]
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [
                "The Kaiju Files"
              ],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [
                "Gameciel, the Sea Turtle Kaiju"
              ],
              "spells": [],
              "grave": [
                "Dogoran, the Mad Flame Kaiju"
              ],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p3": {
              "lp": 16000,
              "hand": [],
              "monsters": [
                "Dogoran, the Mad Flame Kaiju"
              ],
              "spells": [],
              "grave": [],
              "banished": []
            }
          }
        }
      ]
    },
    "watch": "Gameciel, the Sea Turtle Kaiju",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "local-controller-summons-14772491-ffa3",
      "title": "14772491: use the real card controller or owner for a summon",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "ffa3",
        "card:14772491",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa3",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Common Soul",
            "Neo-Spacian Aqua Dolphin"
          ]
        },
        "p1": {
          "monsters": [
            "Celtic Guardian"
          ]
        },
        "p2": {
          "monsters": [
            "Battle Ox"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Common Soul",
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            "Battle Ox"
          ]
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [
                "Common Soul"
              ],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [
                "Celtic Guardian"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [
                "Battle Ox",
                "Neo-Spacian Aqua Dolphin"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Neo-Spacian Aqua Dolphin",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "local-controller-summons-14772491-ffa4",
      "title": "14772491: use the real card controller or owner for a summon",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "ffa4",
        "card:14772491",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa4",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Common Soul",
            "Neo-Spacian Aqua Dolphin"
          ]
        },
        "p1": {
          "monsters": [
            "Celtic Guardian"
          ]
        },
        "p3": {
          "monsters": [
            "Battle Ox"
          ]
        },
        "p2": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Common Soul",
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            "Battle Ox"
          ]
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [
                "Common Soul"
              ],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [
                "Celtic Guardian"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p3": {
              "monsters": [
                "Battle Ox",
                "Neo-Spacian Aqua Dolphin"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Neo-Spacian Aqua Dolphin",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "local-controller-summons-14772491-tag",
      "title": "14772491: use the real card controller or owner for a summon",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "tag",
        "card:14772491"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Common Soul",
            "Neo-Spacian Aqua Dolphin"
          ]
        },
        "p1": {
          "monsters": [
            "Celtic Guardian"
          ]
        },
        "p3": {
          "monsters": [
            "Battle Ox"
          ]
        },
        "p2": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Common Soul",
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            "Battle Ox"
          ]
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [
                "Common Soul"
              ],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [
                "Celtic Guardian"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [
                "Battle Ox",
                "Neo-Spacian Aqua Dolphin"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            }
          }
        }
      ]
    },
    "watch": "Neo-Spacian Aqua Dolphin",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "local-controller-summons-14772491-tag-partner",
      "title": "14772491: use the real card controller or owner for a summon",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "tag",
        "card:14772491"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Common Soul",
            "Neo-Spacian Aqua Dolphin"
          ]
        },
        "p1": {
          "monsters": [
            "Celtic Guardian"
          ]
        },
        "p2": {
          "monsters": [
            "Battle Ox"
          ]
        },
        "p3": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Common Soul",
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            "Battle Ox"
          ]
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [
                "Common Soul"
              ],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [
                "Celtic Guardian"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [
                "Battle Ox",
                "Neo-Spacian Aqua Dolphin"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p3": {
              "lp": 16000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": []
            }
          }
        }
      ]
    },
    "watch": "Neo-Spacian Aqua Dolphin",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "local-controller-summons-45112597-ffa3",
      "title": "45112597: use the real card controller or owner for a summon",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "ffa3",
        "card:45112597",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa3",
        "attackFirstTurn": true,
        "p0": {
          "monsters": [
            "Worldsea Dragon Zealantis"
          ]
        },
        "p1": {
          "monsters": [
            "Battle Ox"
          ]
        },
        "p2": {
          "monsters": [
            "Battle Ox"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Worldsea Dragon Zealantis",
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Worldsea Dragon Zealantis"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [
                "Battle Ox"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [
                "Battle Ox"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Battle Ox",
    "actor": 0,
    "target": 2,
    "banish": [
      1,
      2
    ]
  },
  {
    "scenario": {
      "id": "local-controller-summons-45112597-ffa4",
      "title": "45112597: use the real card controller or owner for a summon",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "ffa4",
        "card:45112597",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa4",
        "attackFirstTurn": true,
        "p0": {
          "monsters": [
            "Worldsea Dragon Zealantis"
          ]
        },
        "p1": {
          "monsters": [
            "Battle Ox"
          ]
        },
        "p2": {
          "monsters": [
            "Battle Ox"
          ]
        },
        "p3": {
          "monsters": [
            "Battle Ox"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Worldsea Dragon Zealantis",
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Worldsea Dragon Zealantis"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [
                "Battle Ox"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [
                "Battle Ox"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p3": {
              "monsters": [
                "Battle Ox"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Battle Ox",
    "actor": 0,
    "target": 3,
    "banish": [
      1,
      2,
      3
    ]
  },
  {
    "scenario": {
      "id": "local-controller-summons-45112597-tag",
      "title": "45112597: use the real card controller or owner for a summon",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "tag",
        "card:45112597"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "monsters": [
            "Worldsea Dragon Zealantis"
          ]
        },
        "p1": {
          "monsters": [
            "Battle Ox"
          ]
        },
        "p2": {
          "monsters": [
            "Battle Ox"
          ]
        },
        "p3": {
          "monsters": [
            "Battle Ox"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Worldsea Dragon Zealantis",
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Worldsea Dragon Zealantis"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [
                "Battle Ox"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [
                "Battle Ox"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [
                "Battle Ox"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            }
          }
        }
      ]
    },
    "watch": "Battle Ox",
    "actor": 0,
    "target": 3,
    "banish": [
      1,
      2,
      3
    ]
  },
  {
    "scenario": {
      "id": "local-controller-summons-45112597-tag-partner",
      "title": "45112597: use the real card controller or owner for a summon",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "tag",
        "card:45112597"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "monsters": [
            "Worldsea Dragon Zealantis"
          ]
        },
        "p1": {
          "monsters": [
            "Battle Ox"
          ]
        },
        "p2": {
          "monsters": [
            "Battle Ox"
          ]
        },
        "p3": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Worldsea Dragon Zealantis",
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Worldsea Dragon Zealantis"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [
                "Battle Ox"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [
                "Battle Ox"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p3": {
              "lp": 16000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": []
            }
          }
        }
      ]
    },
    "watch": "Battle Ox",
    "actor": 0,
    "target": 2,
    "banish": [
      1,
      2
    ]
  },
  {
    "scenario": {
      "id": "local-controller-summons-68223137-ffa3",
      "title": "68223137: use the real card controller or owner for a summon",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "ffa3",
        "card:68223137",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa3",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Dark Hole",
            "One-Kuri-Way"
          ]
        },
        "p2": {
          "monsters": [
            "Linkuriboh"
          ]
        },
        "p1": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Dark Hole",
          "by": "p0"
        },
        {
          "op": "activate",
          "sel": "One-Kuri-Way",
          "by": "p0"
        },
        {
          "op": "yes",
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Dark Hole",
                "One-Kuri-Way"
              ],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [
                "Linkuriboh"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Linkuriboh",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "local-controller-summons-68223137-ffa4",
      "title": "68223137: use the real card controller or owner for a summon",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "ffa4",
        "card:68223137",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa4",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Dark Hole",
            "One-Kuri-Way"
          ]
        },
        "p3": {
          "monsters": [
            "Linkuriboh"
          ]
        },
        "p1": {},
        "p2": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Dark Hole",
          "by": "p0"
        },
        {
          "op": "activate",
          "sel": "One-Kuri-Way",
          "by": "p0"
        },
        {
          "op": "yes",
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Dark Hole",
                "One-Kuri-Way"
              ],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p3": {
              "monsters": [
                "Linkuriboh"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Linkuriboh",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "local-controller-summons-68223137-tag",
      "title": "68223137: use the real card controller or owner for a summon",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "tag",
        "card:68223137"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Dark Hole",
            "One-Kuri-Way"
          ]
        },
        "p3": {
          "monsters": [
            "Linkuriboh"
          ]
        },
        "p1": {},
        "p2": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Dark Hole",
          "by": "p0"
        },
        {
          "op": "activate",
          "sel": "One-Kuri-Way",
          "by": "p0"
        },
        {
          "op": "yes",
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Dark Hole",
                "One-Kuri-Way"
              ],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [
                "Linkuriboh"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            }
          }
        }
      ]
    },
    "watch": "Linkuriboh",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "local-controller-summons-68223137-tag-partner",
      "title": "68223137: use the real card controller or owner for a summon",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "tag",
        "card:68223137"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Dark Hole",
            "One-Kuri-Way"
          ]
        },
        "p1": {},
        "p2": {
          "monsters": [
            "Linkuriboh"
          ]
        },
        "p3": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Dark Hole",
          "by": "p0"
        },
        {
          "op": "activate",
          "sel": "One-Kuri-Way",
          "by": "p0"
        },
        {
          "op": "yes",
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Dark Hole",
                "One-Kuri-Way"
              ],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [
                "Linkuriboh"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p3": {
              "lp": 16000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": []
            }
          }
        }
      ]
    },
    "watch": "Linkuriboh",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "local-controller-summons-76524506-ffa3",
      "title": "76524506: use the real card controller or owner for a summon",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "ffa3",
        "card:76524506",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa3",
        "attackFirstTurn": true,
        "p0": {
          "monsters": [
            "Garden Rose Flora"
          ]
        },
        "p2": {
          "field": "Mountain"
        },
        "p1": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Garden Rose Flora",
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Garden Rose Flora"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [
                "Rose Token"
              ],
              "spells": [],
              "grave": [
                "Mountain"
              ],
              "banished": [],
              "hand": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Rose Token",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "local-controller-summons-76524506-ffa4",
      "title": "76524506: use the real card controller or owner for a summon",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "ffa4",
        "card:76524506",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa4",
        "attackFirstTurn": true,
        "p0": {
          "monsters": [
            "Garden Rose Flora"
          ]
        },
        "p3": {
          "field": "Mountain"
        },
        "p1": {},
        "p2": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Garden Rose Flora",
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Garden Rose Flora"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p3": {
              "monsters": [
                "Rose Token"
              ],
              "spells": [],
              "grave": [
                "Mountain"
              ],
              "banished": [],
              "hand": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Rose Token",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "local-controller-summons-76524506-tag",
      "title": "76524506: use the real card controller or owner for a summon",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "tag",
        "card:76524506"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "monsters": [
            "Garden Rose Flora"
          ]
        },
        "p3": {
          "field": "Mountain"
        },
        "p1": {},
        "p2": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Garden Rose Flora",
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Garden Rose Flora"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [
                "Rose Token"
              ],
              "spells": [],
              "grave": [
                "Mountain"
              ],
              "banished": [],
              "hand": [],
              "lp": 16000
            }
          }
        }
      ]
    },
    "watch": "Rose Token",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "local-controller-summons-76524506-tag-partner",
      "title": "76524506: use the real card controller or owner for a summon",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "tag",
        "card:76524506"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "monsters": [
            "Garden Rose Flora"
          ]
        },
        "p1": {},
        "p2": {
          "field": "Mountain"
        },
        "p3": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Garden Rose Flora",
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Garden Rose Flora"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [
                "Rose Token"
              ],
              "spells": [],
              "grave": [
                "Mountain"
              ],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p3": {
              "lp": 16000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": []
            }
          }
        }
      ]
    },
    "watch": "Rose Token",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "local-controller-summons-90500169-ffa3",
      "title": "90500169: use the real card controller or owner for a summon",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "ffa3",
        "card:90500169",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa3",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Level Down!?"
          ]
        },
        "p1": {
          "grave": [
            "Armed Dragon LV3"
          ]
        },
        "p2": {
          "monsters": [
            "Armed Dragon LV5"
          ],
          "grave": [
            "Armed Dragon LV3",
            "Armed Dragon LV3"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Level Down!?",
          "by": "p0"
        },
        {
          "op": "zone",
          "by": "p0",
          "owner": "p0",
          "zone": "s0"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "seat": "p2",
              "card": "Armed Dragon LV3"
            },
            {
              "seat": "p2",
              "card": "Armed Dragon LV3"
            }
          ],
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            {
              "card": "Armed Dragon LV3",
              "owner": "p2"
            }
          ],
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Level Down!?"
              ],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Armed Dragon LV3"
              ],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [
                "Armed Dragon LV3"
              ],
              "spells": [],
              "grave": [
                "Armed Dragon LV3"
              ],
              "banished": [],
              "hand": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Armed Dragon LV3",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "local-controller-summons-90500169-ffa4",
      "title": "90500169: use the real card controller or owner for a summon",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "ffa4",
        "card:90500169",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa4",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Level Down!?"
          ]
        },
        "p1": {
          "grave": [
            "Armed Dragon LV3"
          ]
        },
        "p3": {
          "monsters": [
            "Armed Dragon LV5"
          ],
          "grave": [
            "Armed Dragon LV3",
            "Armed Dragon LV3"
          ]
        },
        "p2": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Level Down!?",
          "by": "p0"
        },
        {
          "op": "zone",
          "by": "p0",
          "owner": "p0",
          "zone": "s0"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "seat": "p3",
              "card": "Armed Dragon LV3"
            },
            {
              "seat": "p3",
              "card": "Armed Dragon LV3"
            }
          ],
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            {
              "card": "Armed Dragon LV3",
              "owner": "p3"
            }
          ],
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Level Down!?"
              ],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Armed Dragon LV3"
              ],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p3": {
              "monsters": [
                "Armed Dragon LV3"
              ],
              "spells": [],
              "grave": [
                "Armed Dragon LV3"
              ],
              "banished": [],
              "hand": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Armed Dragon LV3",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "local-controller-summons-90500169-tag",
      "title": "90500169: use the real card controller or owner for a summon",
      "source": "R-TAG-SHARED-CARDS: the named owner or controller shares field and Graveyard with the partner; hand and Deck stay per real seat. DECISIONS: Tag keeps the official TCG Tag rules. Level Down returns LV5 to the real owner Deck and summons to the real owner seat.",
      "tags": [
        "multiplayer",
        "tag",
        "card:90500169"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Level Down!?"
          ]
        },
        "p1": {
          "grave": [
            "Armed Dragon LV3"
          ]
        },
        "p3": {
          "monsters": [
            "Armed Dragon LV5"
          ],
          "grave": [
            "Armed Dragon LV3",
            "Armed Dragon LV3"
          ]
        },
        "p2": {
          "grave": [
            "Armed Dragon LV3"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Level Down!?",
          "by": "p0"
        },
        {
          "op": "zone",
          "by": "p0",
          "owner": "p0",
          "zone": "s0"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "seat": "p1",
              "card": "Armed Dragon LV3"
            },
            {
              "seat": "p3",
              "card": "Armed Dragon LV3"
            },
            {
              "seat": "p3",
              "card": "Armed Dragon LV3"
            }
          ],
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            {
              "owner": "p1",
              "card": "Armed Dragon LV3"
            }
          ],
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Level Down!?"
              ],
              "banished": [],
              "hand": [],
              "lp": 16000,
              "deckCount": 20
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000,
              "deckCount": 20
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Armed Dragon LV3"
              ],
              "banished": [],
              "hand": [],
              "lp": 16000,
              "deckCount": 20
            },
            "p3": {
              "monsters": [
                "Armed Dragon LV3"
              ],
              "spells": [],
              "grave": [
                "Armed Dragon LV3",
                "Armed Dragon LV3"
              ],
              "banished": [],
              "hand": [],
              "lp": 16000,
              "deckCount": 21
            }
          }
        }
      ]
    },
    "watch": "Armed Dragon LV3",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "local-controller-summons-90500169-tag-partner",
      "title": "90500169: use the real card controller or owner for a summon",
      "source": "R-TAG-SHARED-CARDS: the named owner or controller shares field and Graveyard with the partner; hand and Deck stay per real seat. DECISIONS: Tag keeps the official TCG Tag rules. Level Down returns LV5 to the real owner Deck and summons to the real owner seat.",
      "tags": [
        "multiplayer",
        "tag",
        "card:90500169"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Level Down!?"
          ],
          "grave": [
            "Armed Dragon LV3"
          ]
        },
        "p1": {
          "grave": [
            "Armed Dragon LV3"
          ]
        },
        "p2": {
          "monsters": [
            "Armed Dragon LV5"
          ],
          "grave": [
            "Armed Dragon LV3",
            "Armed Dragon LV3"
          ]
        },
        "p3": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Level Down!?",
          "by": "p0"
        },
        {
          "op": "zone",
          "by": "p0",
          "owner": "p0",
          "zone": "s0"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "seat": "p0",
              "card": "Armed Dragon LV3"
            },
            {
              "seat": "p2",
              "card": "Armed Dragon LV3"
            },
            {
              "seat": "p2",
              "card": "Armed Dragon LV3"
            }
          ],
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            {
              "owner": "p0",
              "card": "Armed Dragon LV3"
            }
          ],
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Level Down!?"
              ],
              "banished": [],
              "hand": [],
              "lp": 16000,
              "deckCount": 20
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Armed Dragon LV3"
              ],
              "banished": [],
              "hand": [],
              "lp": 16000,
              "deckCount": 20
            },
            "p2": {
              "monsters": [
                "Armed Dragon LV3"
              ],
              "spells": [],
              "grave": [
                "Armed Dragon LV3",
                "Armed Dragon LV3"
              ],
              "banished": [],
              "hand": [],
              "lp": 16000,
              "deckCount": 21
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
      ]
    },
    "watch": "Armed Dragon LV3",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "local-controller-summons-91742238-ffa3",
      "title": "91742238: use the real card controller or owner for a summon",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "ffa3",
        "card:91742238",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa3",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            {
              "card": "Return of the Zombies",
              "pos": "set"
            }
          ]
        },
        "p1": {
          "grave": [
            "Armored Zombie"
          ]
        },
        "p2": {
          "monsters": [
            "Clown Zombie"
          ],
          "grave": [
            "Armored Zombie",
            "Armored Zombie"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Return of the Zombies",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "seat": "p2",
              "card": "Armored Zombie"
            },
            {
              "seat": "p2",
              "card": "Armored Zombie"
            }
          ],
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            {
              "card": "Armored Zombie",
              "owner": "p2"
            }
          ],
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Return of the Zombies"
              ],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Armored Zombie"
              ],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [
                "Armored Zombie"
              ],
              "spells": [],
              "grave": [
                "Armored Zombie"
              ],
              "banished": [
                "Clown Zombie"
              ],
              "hand": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Armored Zombie",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "local-controller-summons-91742238-ffa4",
      "title": "91742238: use the real card controller or owner for a summon",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "ffa4",
        "card:91742238",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa4",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            {
              "card": "Return of the Zombies",
              "pos": "set"
            }
          ]
        },
        "p1": {
          "grave": [
            "Armored Zombie"
          ]
        },
        "p3": {
          "monsters": [
            "Clown Zombie"
          ],
          "grave": [
            "Armored Zombie",
            "Armored Zombie"
          ]
        },
        "p2": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Return of the Zombies",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "seat": "p3",
              "card": "Armored Zombie"
            },
            {
              "seat": "p3",
              "card": "Armored Zombie"
            }
          ],
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            {
              "card": "Armored Zombie",
              "owner": "p3"
            }
          ],
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Return of the Zombies"
              ],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Armored Zombie"
              ],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p3": {
              "monsters": [
                "Armored Zombie"
              ],
              "spells": [],
              "grave": [
                "Armored Zombie"
              ],
              "banished": [
                "Clown Zombie"
              ],
              "hand": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Armored Zombie",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "local-controller-summons-91742238-tag",
      "title": "91742238: use the real card controller or owner for a summon",
      "source": "R-TAG-SHARED-CARDS: the named owner or controller shares field and Graveyard with the partner; hand and Deck stay per real seat. DECISIONS: Tag keeps the official TCG Tag rules.",
      "tags": [
        "multiplayer",
        "tag",
        "card:91742238"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            {
              "card": "Return of the Zombies",
              "pos": "set"
            }
          ]
        },
        "p1": {
          "grave": [
            "Armored Zombie"
          ]
        },
        "p3": {
          "monsters": [
            "Clown Zombie"
          ],
          "grave": [
            "Armored Zombie",
            "Armored Zombie"
          ]
        },
        "p2": {
          "grave": [
            "Armored Zombie"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Return of the Zombies",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "seat": "p1",
              "card": "Armored Zombie"
            },
            {
              "seat": "p3",
              "card": "Armored Zombie"
            },
            {
              "seat": "p3",
              "card": "Armored Zombie"
            }
          ],
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            {
              "owner": "p1",
              "card": "Armored Zombie"
            }
          ],
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Return of the Zombies"
              ],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Armored Zombie"
              ],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [
                "Armored Zombie"
              ],
              "spells": [],
              "grave": [
                "Armored Zombie",
                "Armored Zombie"
              ],
              "banished": [
                "Clown Zombie"
              ],
              "hand": [],
              "lp": 16000
            }
          }
        }
      ]
    },
    "watch": "Armored Zombie",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "local-controller-summons-91742238-tag-partner",
      "title": "91742238: use the real card controller or owner for a summon",
      "source": "R-TAG-SHARED-CARDS: the named owner or controller shares field and Graveyard with the partner; hand and Deck stay per real seat. DECISIONS: Tag keeps the official TCG Tag rules.",
      "tags": [
        "multiplayer",
        "tag",
        "card:91742238"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            {
              "card": "Return of the Zombies",
              "pos": "set"
            }
          ],
          "grave": [
            "Armored Zombie"
          ]
        },
        "p1": {
          "grave": [
            "Armored Zombie"
          ]
        },
        "p2": {
          "monsters": [
            "Clown Zombie"
          ],
          "grave": [
            "Armored Zombie",
            "Armored Zombie"
          ]
        },
        "p3": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Return of the Zombies",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "seat": "p0",
              "card": "Armored Zombie"
            },
            {
              "seat": "p2",
              "card": "Armored Zombie"
            },
            {
              "seat": "p2",
              "card": "Armored Zombie"
            }
          ],
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            {
              "owner": "p0",
              "card": "Armored Zombie"
            }
          ],
          "by": "p0"
        },
        {
          "op": "pass",
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "context": "action"
          }
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Return of the Zombies"
              ],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Armored Zombie"
              ],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [
                "Armored Zombie"
              ],
              "spells": [],
              "grave": [
                "Armored Zombie",
                "Armored Zombie"
              ],
              "banished": [
                "Clown Zombie"
              ],
              "hand": [],
              "lp": 16000
            },
            "p3": {
              "lp": 16000,
              "hand": [],
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": []
            }
          }
        }
      ]
    },
    "watch": "Armored Zombie",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "owner-field-4145915-ffa3-p0-returns-to-p2",
      "title": "FFA3: p0 uses Gimmick Puppet Fiendish Knight; the monster returns to p2",
      "source": "DECISIONS Owner answers 2026-10-02 (afternoon): return to real owner in all tables, Tag too; proposed R-COMMON-RETURN-TO-OWNER",
      "tags": [
        "multiplayer",
        "ffa3",
        "card:4145915",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa3",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Gimmick Puppet Fiendish Knight"
          ]
        },
        "p2": {
          "grave": [
            "Mystical Elf"
          ]
        },
        "p1": {
          "grave": [
            "Battle Ox"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Gimmick Puppet Fiendish Knight",
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            {
              "card": "Mystical Elf",
              "owner": "p2"
            }
          ],
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Gimmick Puppet Fiendish Knight"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Battle Ox"
              ],
              "banished": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Mystical Elf",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "owner-field-40155014-ffa3-p0-returns-to-p2",
      "title": "FFA3: p0 uses Centur-Ion Phalanx; the monster returns to p2",
      "source": "DECISIONS Owner answers 2026-10-02 (afternoon): return to real owner in all tables, Tag too; proposed R-COMMON-RETURN-TO-OWNER",
      "tags": [
        "multiplayer",
        "ffa3",
        "card:40155014",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa3",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            {
              "card": "Centur-Ion Phalanx",
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
          "sel": "Centur-Ion Phalanx",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Centur-Ion Phalanx"
              ],
              "banished": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [
                "Mystical Elf"
              ],
              "lp": 8000
            }
          }
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Centur-Ion Phalanx"
              ],
              "banished": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Mystical Elf",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "owner-field-4145915-ffa3-p1-returns-to-p2",
      "title": "FFA3: p1 uses Gimmick Puppet Fiendish Knight; the monster returns to p2",
      "source": "DECISIONS Owner answers 2026-10-02 (afternoon): return to real owner in all tables, Tag too; proposed R-COMMON-RETURN-TO-OWNER",
      "tags": [
        "multiplayer",
        "ffa3",
        "card:4145915",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa3",
        "attackFirstTurn": true,
        "p1": {
          "hand": [
            "Gimmick Puppet Fiendish Knight"
          ]
        },
        "p2": {
          "grave": [
            "Mystical Elf"
          ]
        },
        "p0": {
          "grave": [
            "Battle Ox"
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
          "sel": "Gimmick Puppet Fiendish Knight",
          "by": "p1"
        },
        {
          "op": "select",
          "sels": [
            {
              "card": "Mystical Elf",
              "owner": "p2"
            }
          ],
          "by": "p1"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Battle Ox"
              ],
              "banished": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [
                "Gimmick Puppet Fiendish Knight"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Mystical Elf",
    "actor": 1,
    "target": 2
  },
  {
    "scenario": {
      "id": "owner-field-40155014-ffa3-p1-returns-to-p2",
      "title": "FFA3: p1 uses Centur-Ion Phalanx; the monster returns to p2",
      "source": "DECISIONS Owner answers 2026-10-02 (afternoon): return to real owner in all tables, Tag too; proposed R-COMMON-RETURN-TO-OWNER",
      "tags": [
        "multiplayer",
        "ffa3",
        "card:40155014",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa3",
        "attackFirstTurn": true,
        "p1": {
          "spells": [
            {
              "card": "Centur-Ion Phalanx",
              "pos": "set"
            }
          ]
        },
        "p2": {
          "monsters": [
            "Mystical Elf"
          ]
        },
        "p0": {}
      },
      "steps": [
        {
          "op": "phase",
          "to": "end",
          "by": "p0"
        },
        {
          "op": "activate",
          "sel": "Centur-Ion Phalanx",
          "by": "p1"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Centur-Ion Phalanx"
              ],
              "banished": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [
                "Mystical Elf"
              ],
              "lp": 8000
            }
          }
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Centur-Ion Phalanx"
              ],
              "banished": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Mystical Elf",
    "actor": 1,
    "target": 2
  },
  {
    "scenario": {
      "id": "owner-field-4145915-ffa4-p0-returns-to-p3",
      "title": "FFA4: p0 uses Gimmick Puppet Fiendish Knight; the monster returns to p3",
      "source": "DECISIONS Owner answers 2026-10-02 (afternoon): return to real owner in all tables, Tag too; proposed R-COMMON-RETURN-TO-OWNER",
      "tags": [
        "multiplayer",
        "ffa4",
        "card:4145915",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa4",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Gimmick Puppet Fiendish Knight"
          ]
        },
        "p3": {
          "grave": [
            "Mystical Elf"
          ]
        },
        "p1": {
          "grave": [
            "Battle Ox"
          ]
        },
        "p2": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Gimmick Puppet Fiendish Knight",
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            {
              "card": "Mystical Elf",
              "owner": "p3"
            }
          ],
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Gimmick Puppet Fiendish Knight"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Battle Ox"
              ],
              "banished": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p3": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Mystical Elf",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "owner-field-40155014-ffa4-p0-returns-to-p3",
      "title": "FFA4: p0 uses Centur-Ion Phalanx; the monster returns to p3",
      "source": "DECISIONS Owner answers 2026-10-02 (afternoon): return to real owner in all tables, Tag too; proposed R-COMMON-RETURN-TO-OWNER",
      "tags": [
        "multiplayer",
        "ffa4",
        "card:40155014",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa4",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            {
              "card": "Centur-Ion Phalanx",
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
          "sel": "Centur-Ion Phalanx",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Centur-Ion Phalanx"
              ],
              "banished": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p3": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [
                "Mystical Elf"
              ],
              "lp": 8000
            }
          }
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Centur-Ion Phalanx"
              ],
              "banished": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p3": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Mystical Elf",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "owner-field-4145915-ffa4-p1-returns-to-p3",
      "title": "FFA4: p1 uses Gimmick Puppet Fiendish Knight; the monster returns to p3",
      "source": "DECISIONS Owner answers 2026-10-02 (afternoon): return to real owner in all tables, Tag too; proposed R-COMMON-RETURN-TO-OWNER",
      "tags": [
        "multiplayer",
        "ffa4",
        "card:4145915",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa4",
        "attackFirstTurn": true,
        "p1": {
          "hand": [
            "Gimmick Puppet Fiendish Knight"
          ]
        },
        "p3": {
          "grave": [
            "Mystical Elf"
          ]
        },
        "p0": {
          "grave": [
            "Battle Ox"
          ]
        },
        "p2": {}
      },
      "steps": [
        {
          "op": "phase",
          "to": "end",
          "by": "p0"
        },
        {
          "op": "activate",
          "sel": "Gimmick Puppet Fiendish Knight",
          "by": "p1"
        },
        {
          "op": "select",
          "sels": [
            {
              "card": "Mystical Elf",
              "owner": "p3"
            }
          ],
          "by": "p1"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Battle Ox"
              ],
              "banished": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [
                "Gimmick Puppet Fiendish Knight"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p3": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Mystical Elf",
    "actor": 1,
    "target": 3
  },
  {
    "scenario": {
      "id": "owner-field-40155014-ffa4-p1-returns-to-p3",
      "title": "FFA4: p1 uses Centur-Ion Phalanx; the monster returns to p3",
      "source": "DECISIONS Owner answers 2026-10-02 (afternoon): return to real owner in all tables, Tag too; proposed R-COMMON-RETURN-TO-OWNER",
      "tags": [
        "multiplayer",
        "ffa4",
        "card:40155014",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa4",
        "attackFirstTurn": true,
        "p1": {
          "spells": [
            {
              "card": "Centur-Ion Phalanx",
              "pos": "set"
            }
          ]
        },
        "p3": {
          "monsters": [
            "Mystical Elf"
          ]
        },
        "p0": {},
        "p2": {}
      },
      "steps": [
        {
          "op": "phase",
          "to": "end",
          "by": "p0"
        },
        {
          "op": "activate",
          "sel": "Centur-Ion Phalanx",
          "by": "p1"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Centur-Ion Phalanx"
              ],
              "banished": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p3": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [
                "Mystical Elf"
              ],
              "lp": 8000
            }
          }
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Centur-Ion Phalanx"
              ],
              "banished": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p3": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Mystical Elf",
    "actor": 1,
    "target": 3
  },
  {
    "scenario": {
      "id": "owner-field-4145915-tag-p0-returns-to-p3",
      "title": "Tag: p0 uses Gimmick Puppet Fiendish Knight; the monster returns to p3",
      "source": "DECISIONS Owner answers 2026-10-02 (afternoon): return to real owner in all tables, Tag too; proposed R-COMMON-RETURN-TO-OWNER",
      "tags": [
        "multiplayer",
        "tag",
        "card:4145915"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Gimmick Puppet Fiendish Knight"
          ]
        },
        "p3": {
          "grave": [
            "Mystical Elf"
          ]
        },
        "p1": {
          "grave": [
            "Battle Ox"
          ]
        },
        "p2": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Gimmick Puppet Fiendish Knight",
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            {
              "card": "Mystical Elf",
              "owner": "p3"
            }
          ]
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Gimmick Puppet Fiendish Knight"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Battle Ox"
              ],
              "banished": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            }
          }
        }
      ]
    },
    "watch": "Mystical Elf",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "owner-field-40155014-tag-p0-returns-to-p3",
      "title": "Tag: p0 uses Centur-Ion Phalanx; the monster returns to p3",
      "source": "DECISIONS Owner answers 2026-10-02 (afternoon): return to real owner in all tables, Tag too; proposed R-COMMON-RETURN-TO-OWNER",
      "tags": [
        "multiplayer",
        "tag",
        "card:40155014"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            {
              "card": "Centur-Ion Phalanx",
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
          "sel": "Centur-Ion Phalanx",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Centur-Ion Phalanx"
              ],
              "banished": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [
                "Mystical Elf"
              ],
              "lp": 16000
            }
          }
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Centur-Ion Phalanx"
              ],
              "banished": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            }
          }
        }
      ]
    },
    "watch": "Mystical Elf",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "owner-field-4145915-tag-p1-returns-to-p2",
      "title": "Tag: p1 uses Gimmick Puppet Fiendish Knight; the monster returns to p2",
      "source": "DECISIONS Owner answers 2026-10-02 (afternoon): return to real owner in all tables, Tag too; proposed R-COMMON-RETURN-TO-OWNER",
      "tags": [
        "multiplayer",
        "tag",
        "card:4145915"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p1": {
          "hand": [
            "Gimmick Puppet Fiendish Knight"
          ]
        },
        "p2": {
          "grave": [
            "Mystical Elf"
          ]
        },
        "p0": {
          "grave": [
            "Battle Ox"
          ]
        },
        "p3": {}
      },
      "steps": [
        {
          "op": "phase",
          "to": "end",
          "by": "p0"
        },
        {
          "op": "activate",
          "sel": "Gimmick Puppet Fiendish Knight",
          "by": "p1"
        },
        {
          "op": "select",
          "sels": [
            {
              "card": "Mystical Elf",
              "owner": "p2"
            }
          ]
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Battle Ox"
              ],
              "banished": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [
                "Gimmick Puppet Fiendish Knight"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            }
          }
        }
      ]
    },
    "watch": "Mystical Elf",
    "actor": 1,
    "target": 2
  },
  {
    "scenario": {
      "id": "owner-field-40155014-tag-p1-returns-to-p2",
      "title": "Tag: p1 uses Centur-Ion Phalanx; the monster returns to p2",
      "source": "DECISIONS Owner answers 2026-10-02 (afternoon): return to real owner in all tables, Tag too; proposed R-COMMON-RETURN-TO-OWNER",
      "tags": [
        "multiplayer",
        "tag",
        "card:40155014"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p1": {
          "spells": [
            {
              "card": "Centur-Ion Phalanx",
              "pos": "set"
            }
          ]
        },
        "p2": {
          "monsters": [
            "Mystical Elf"
          ]
        },
        "p0": {},
        "p3": {}
      },
      "steps": [
        {
          "op": "phase",
          "to": "end",
          "by": "p0"
        },
        {
          "op": "activate",
          "sel": "Centur-Ion Phalanx",
          "by": "p1"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Centur-Ion Phalanx"
              ],
              "banished": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [
                "Mystical Elf"
              ],
              "lp": 16000
            },
            "p3": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            }
          }
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Centur-Ion Phalanx"
              ],
              "banished": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            }
          }
        }
      ]
    },
    "watch": "Mystical Elf",
    "actor": 1,
    "target": 2
  },
  {
    "scenario": {
      "id": "owner-field-4145915-tag-p0-returns-to-p2",
      "title": "Tag: p0 uses Gimmick Puppet Fiendish Knight; the monster returns to p2",
      "source": "DECISIONS Owner answers 2026-10-02 (afternoon): return to real owner in all tables, Tag too; proposed R-COMMON-RETURN-TO-OWNER",
      "tags": [
        "multiplayer",
        "tag",
        "card:4145915"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Gimmick Puppet Fiendish Knight"
          ]
        },
        "p2": {
          "grave": [
            "Gimmick Puppet Humpty Dumpty"
          ]
        },
        "p1": {
          "grave": [
            "Battle Ox"
          ]
        },
        "p3": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Gimmick Puppet Fiendish Knight",
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            {
              "card": "Gimmick Puppet Humpty Dumpty",
              "owner": "p2"
            }
          ]
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Gimmick Puppet Fiendish Knight"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Battle Ox"
              ],
              "banished": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [
                "Gimmick Puppet Humpty Dumpty"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            }
          }
        }
      ]
    },
    "watch": "Gimmick Puppet Humpty Dumpty",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "owner-field-40155014-tag-p0-returns-to-p2",
      "title": "Tag: p0 uses Centur-Ion Phalanx; the monster returns to p2",
      "source": "DECISIONS Owner answers 2026-10-02 (afternoon): return to real owner in all tables, Tag too; proposed R-COMMON-RETURN-TO-OWNER",
      "tags": [
        "multiplayer",
        "tag",
        "card:40155014"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            {
              "card": "Centur-Ion Phalanx",
              "pos": "set"
            }
          ]
        },
        "p2": {
          "monsters": [
            "Mystical Elf"
          ]
        },
        "p1": {},
        "p3": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Centur-Ion Phalanx",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Centur-Ion Phalanx"
              ],
              "banished": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [
                "Mystical Elf"
              ],
              "lp": 16000
            },
            "p3": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            }
          }
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Centur-Ion Phalanx"
              ],
              "banished": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            }
          }
        }
      ]
    },
    "watch": "Mystical Elf",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "owner-field-4145915-tag-p1-returns-to-p3",
      "title": "Tag: p1 uses Gimmick Puppet Fiendish Knight; the monster returns to p3",
      "source": "DECISIONS Owner answers 2026-10-02 (afternoon): return to real owner in all tables, Tag too; proposed R-COMMON-RETURN-TO-OWNER",
      "tags": [
        "multiplayer",
        "tag",
        "card:4145915"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p1": {
          "hand": [
            "Gimmick Puppet Fiendish Knight"
          ]
        },
        "p3": {
          "grave": [
            "Gimmick Puppet Humpty Dumpty"
          ]
        },
        "p0": {
          "grave": [
            "Battle Ox"
          ]
        },
        "p2": {}
      },
      "steps": [
        {
          "op": "phase",
          "to": "end",
          "by": "p0"
        },
        {
          "op": "activate",
          "sel": "Gimmick Puppet Fiendish Knight",
          "by": "p1"
        },
        {
          "op": "select",
          "sels": [
            {
              "card": "Gimmick Puppet Humpty Dumpty",
              "owner": "p3"
            }
          ]
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Battle Ox"
              ],
              "banished": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [
                "Gimmick Puppet Fiendish Knight"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [
                "Gimmick Puppet Humpty Dumpty"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            }
          }
        }
      ]
    },
    "watch": "Gimmick Puppet Humpty Dumpty",
    "actor": 1,
    "target": 3
  },
  {
    "scenario": {
      "id": "owner-field-40155014-tag-p1-returns-to-p3",
      "title": "Tag: p1 uses Centur-Ion Phalanx; the monster returns to p3",
      "source": "DECISIONS Owner answers 2026-10-02 (afternoon): return to real owner in all tables, Tag too; proposed R-COMMON-RETURN-TO-OWNER",
      "tags": [
        "multiplayer",
        "tag",
        "card:40155014"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p1": {
          "spells": [
            {
              "card": "Centur-Ion Phalanx",
              "pos": "set"
            }
          ]
        },
        "p3": {
          "monsters": [
            "Mystical Elf"
          ]
        },
        "p0": {},
        "p2": {}
      },
      "steps": [
        {
          "op": "phase",
          "to": "end",
          "by": "p0"
        },
        {
          "op": "activate",
          "sel": "Centur-Ion Phalanx",
          "by": "p1"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Centur-Ion Phalanx"
              ],
              "banished": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [
                "Mystical Elf"
              ],
              "lp": 16000
            }
          }
        },
        {
          "op": "phase",
          "to": "end",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Centur-Ion Phalanx"
              ],
              "banished": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            }
          }
        }
      ]
    },
    "watch": "Mystical Elf",
    "actor": 1,
    "target": 3
  },
  {
    "scenario": {
      "id": "black-dragon-ffa3",
      "title": "Black Dragon Ninja returns late owner",
      "source": "ADR-0002",
      "setup": {
        "format": "ffa3",
        "attackFirstTurn": true,
        "p0": {
          "monsters": [
            "Black Dragon Ninja"
          ],
          "hand": [
            "Ninja Grandmaster Hanzo",
            "Ninjitsu Art of Transformation",
            "Dark Hole"
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
          "sel": "Black Dragon Ninja",
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            "Ninja Grandmaster Hanzo"
          ]
        },
        {
          "op": "select",
          "sels": [
            "Mystical Elf"
          ]
        },
        {
          "op": "activate",
          "sel": "Dark Hole",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Ninja Grandmaster Hanzo",
                "Ninjitsu Art of Transformation",
                "Dark Hole",
                "Black Dragon Ninja"
              ],
              "banished": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            }
          }
        }
      ],
      "tags": [
        "stock-standard-opening-draw"
      ]
    },
    "watch": "Mystical Elf",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "black-dragon-ffa4",
      "title": "Black Dragon Ninja returns late owner",
      "source": "ADR-0002",
      "setup": {
        "format": "ffa4",
        "attackFirstTurn": true,
        "p0": {
          "monsters": [
            "Black Dragon Ninja"
          ],
          "hand": [
            "Ninja Grandmaster Hanzo",
            "Ninjitsu Art of Transformation",
            "Dark Hole"
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
          "sel": "Black Dragon Ninja",
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            "Ninja Grandmaster Hanzo"
          ]
        },
        {
          "op": "select",
          "sels": [
            "Mystical Elf"
          ]
        },
        {
          "op": "activate",
          "sel": "Dark Hole",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Ninja Grandmaster Hanzo",
                "Ninjitsu Art of Transformation",
                "Dark Hole",
                "Black Dragon Ninja"
              ],
              "banished": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p3": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            }
          }
        }
      ],
      "tags": [
        "stock-standard-opening-draw"
      ]
    },
    "watch": "Mystical Elf",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "black-dragon-tag",
      "title": "Black Dragon Ninja returns late owner",
      "source": "ADR-0002",
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "monsters": [
            "Black Dragon Ninja"
          ],
          "hand": [
            "Ninja Grandmaster Hanzo",
            "Ninjitsu Art of Transformation",
            "Dark Hole"
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
          "sel": "Black Dragon Ninja",
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            "Ninja Grandmaster Hanzo"
          ]
        },
        {
          "op": "select",
          "sels": [
            "Mystical Elf"
          ]
        },
        {
          "op": "activate",
          "sel": "Dark Hole",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Ninja Grandmaster Hanzo",
                "Ninjitsu Art of Transformation",
                "Dark Hole",
                "Black Dragon Ninja"
              ],
              "banished": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            }
          }
        }
      ],
      "tags": [
        "multiplayer",
        "action-seat",
        "tag"
      ]
    },
    "watch": "Mystical Elf",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "combination-ffa3",
      "title": "Combination returns Union controller",
      "source": "ADR-0002",
      "setup": {
        "format": "ffa3",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            {
              "card": "Combination Attack",
              "pos": "set"
            }
          ]
        },
        "p1": {
          "monsters": [
            {
              "card": "Mystical Elf",
              "pos": "def"
            }
          ]
        },
        "p2": {
          "monsters": [
            "X-Head Cannon",
            "Y-Dragon Head"
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
          "op": "activate",
          "sel": "Y-Dragon Head",
          "by": "p2"
        },
        {
          "op": "attack",
          "attacker": "X-Head Cannon",
          "target": "Mystical Elf",
          "by": "p2"
        },
        {
          "op": "activate",
          "sel": "Combination Attack",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Combination Attack"
              ],
              "banished": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [
                "X-Head Cannon",
                "Y-Dragon Head"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 7800
            }
          }
        }
      ],
      "tags": [
        "stock-standard-opening-draw"
      ]
    },
    "watch": "Y-Dragon Head",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "combination-ffa4",
      "title": "Combination returns Union controller",
      "source": "ADR-0002",
      "setup": {
        "format": "ffa4",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            {
              "card": "Combination Attack",
              "pos": "set"
            }
          ]
        },
        "p1": {
          "monsters": [
            {
              "card": "Mystical Elf",
              "pos": "def"
            }
          ]
        },
        "p3": {
          "monsters": [
            "X-Head Cannon",
            "Y-Dragon Head"
          ]
        },
        "p2": {}
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
          "op": "activate",
          "sel": "Y-Dragon Head",
          "by": "p3"
        },
        {
          "op": "attack",
          "attacker": "X-Head Cannon",
          "target": "Mystical Elf",
          "by": "p3"
        },
        {
          "op": "activate",
          "sel": "Combination Attack",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Combination Attack"
              ],
              "banished": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p3": {
              "monsters": [
                "X-Head Cannon",
                "Y-Dragon Head"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 7800
            }
          }
        }
      ],
      "tags": [
        "stock-standard-opening-draw"
      ]
    },
    "watch": "Y-Dragon Head",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "combination-tag",
      "title": "Combination returns Union controller",
      "source": "ADR-0002",
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "monsters": [
            {
              "card": "Mystical Elf",
              "pos": "def"
            }
          ],
          "spells": [
            {
              "card": "Combination Attack",
              "pos": "set"
            }
          ]
        },
        "p3": {
          "monsters": [
            "X-Head Cannon",
            "Y-Dragon Head"
          ]
        },
        "p1": {},
        "p2": {}
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
          "op": "activate",
          "sel": "Y-Dragon Head",
          "by": "p3"
        },
        {
          "op": "attack",
          "attacker": "X-Head Cannon",
          "target": "Mystical Elf",
          "by": "p3"
        },
        {
          "op": "activate",
          "sel": "Combination Attack",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [
                "Mystical Elf"
              ],
              "spells": [],
              "grave": [
                "Combination Attack"
              ],
              "banished": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 15800
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [
                "X-Head Cannon",
                "Y-Dragon Head"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 15800
            }
          }
        }
      ],
      "tags": [
        "multiplayer",
        "action-seat",
        "tag"
      ]
    },
    "watch": "Y-Dragon Head",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "hydor-owner-ffa3-p0",
      "title": "ffa3: Hydor checks and returns to p2",
      "source": "packages/duel-server/domain-core/.build/phase2/briefs/DECISIONS-2026-10-01.md: Owner answers 2026-10-02 (afternoon), effect returns to the real owner",
      "tags": [
        "multiplayer",
        "ffa3",
        "card:30339825",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa3",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Hydor, the Base of All Things"
          ]
        },
        "p2": {
          "grave": [
            "Celtic Guardian"
          ],
          "monsters": [
            "Aqua Madoor",
            "Mother Grizzly"
          ]
        },
        "p1": {
          "monsters": [
            "Penguin Soldier"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Hydor, the Base of All Things",
          "by": "p0"
        },
        {
          "op": "zone",
          "owner": "p0",
          "zone": "s0",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "seat": "p2",
              "card": "Aqua Madoor"
            },
            {
              "seat": "p2",
              "card": "Mother Grizzly"
            }
          ],
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "title": "Select the card(s) to destroy"
          }
        },
        {
          "op": "select",
          "sels": [
            "Aqua Madoor"
          ]
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Hydor, the Base of All Things"
              ],
              "banished": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [
                "Penguin Soldier"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [
                "Celtic Guardian",
                "Mother Grizzly"
              ],
              "spells": [],
              "grave": [
                "Aqua Madoor"
              ],
              "banished": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Celtic Guardian",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "hydor-owner-ffa4-p0",
      "title": "ffa4: Hydor checks and returns to p3",
      "source": "packages/duel-server/domain-core/.build/phase2/briefs/DECISIONS-2026-10-01.md: Owner answers 2026-10-02 (afternoon), effect returns to the real owner",
      "tags": [
        "multiplayer",
        "ffa4",
        "card:30339825",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa4",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Hydor, the Base of All Things"
          ]
        },
        "p3": {
          "grave": [
            "Celtic Guardian"
          ],
          "monsters": [
            "Aqua Madoor",
            "Mother Grizzly"
          ]
        },
        "p1": {
          "monsters": [
            "Penguin Soldier"
          ]
        },
        "p2": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Hydor, the Base of All Things",
          "by": "p0"
        },
        {
          "op": "zone",
          "owner": "p0",
          "zone": "s0",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "seat": "p3",
              "card": "Aqua Madoor"
            },
            {
              "seat": "p3",
              "card": "Mother Grizzly"
            }
          ],
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "title": "Select the card(s) to destroy"
          }
        },
        {
          "op": "select",
          "sels": [
            "Aqua Madoor"
          ]
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Hydor, the Base of All Things"
              ],
              "banished": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [
                "Penguin Soldier"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 8000
            },
            "p3": {
              "monsters": [
                "Celtic Guardian",
                "Mother Grizzly"
              ],
              "spells": [],
              "grave": [
                "Aqua Madoor"
              ],
              "banished": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Celtic Guardian",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "hydor-owner-tag-p0",
      "title": "tag: Hydor checks and returns to p3",
      "source": "R-TAG-SHARED-CARDS: the named owner or controller shares field and Graveyard with the partner; hand and Deck stay per real seat. DECISIONS: Tag keeps the official TCG Tag rules. Hydor checks free zones and summons at the real owner seat.",
      "tags": [
        "multiplayer",
        "tag",
        "card:30339825"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Hydor, the Base of All Things"
          ]
        },
        "p3": {
          "grave": [
            "Celtic Guardian"
          ],
          "monsters": [
            "Aqua Madoor",
            "Mother Grizzly"
          ]
        },
        "p1": {
          "monsters": [
            "Penguin Soldier"
          ]
        },
        "p2": {
          "monsters": [
            "Penguin Soldier"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Hydor, the Base of All Things",
          "by": "p0"
        },
        {
          "op": "zone",
          "owner": "p0",
          "zone": "s0",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "seat": "p3",
              "card": "Aqua Madoor"
            },
            {
              "seat": "p3",
              "card": "Mother Grizzly"
            },
            {
              "seat": "p1",
              "card": "Penguin Soldier"
            }
          ],
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "title": "Select the card(s) to destroy"
          }
        },
        {
          "op": "select",
          "sels": [
            {
              "owner": "p1",
              "card": "Penguin Soldier"
            }
          ]
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Hydor, the Base of All Things"
              ],
              "banished": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Penguin Soldier"
              ],
              "banished": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [
                "Penguin Soldier"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [
                "Aqua Madoor",
                "Mother Grizzly",
                "Celtic Guardian"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            }
          }
        }
      ]
    },
    "watch": "Celtic Guardian",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "hydor-owner-tag-p1",
      "title": "tag: Hydor checks and returns to p2",
      "source": "R-TAG-SHARED-CARDS: the named owner or controller shares field and Graveyard with the partner; hand and Deck stay per real seat. DECISIONS: Tag keeps the official TCG Tag rules. Hydor checks free zones and summons at the real owner seat.",
      "tags": [
        "multiplayer",
        "tag",
        "card:30339825"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p1": {
          "hand": [
            "Hydor, the Base of All Things"
          ]
        },
        "p2": {
          "grave": [
            "Celtic Guardian"
          ],
          "monsters": [
            "Aqua Madoor",
            "Mother Grizzly"
          ]
        },
        "p0": {
          "monsters": [
            "Penguin Soldier"
          ]
        },
        "p3": {
          "monsters": [
            "Penguin Soldier"
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
          "sel": "Hydor, the Base of All Things",
          "by": "p1"
        },
        {
          "op": "zone",
          "owner": "p1",
          "zone": "s0",
          "by": "p1"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "seat": "p2",
              "card": "Aqua Madoor"
            },
            {
              "seat": "p2",
              "card": "Mother Grizzly"
            },
            {
              "seat": "p0",
              "card": "Penguin Soldier"
            }
          ],
          "by": "p1"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p1",
            "title": "Select the card(s) to destroy"
          }
        },
        {
          "op": "select",
          "sels": [
            {
              "owner": "p0",
              "card": "Penguin Soldier"
            }
          ]
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Penguin Soldier"
              ],
              "banished": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Hydor, the Base of All Things"
              ],
              "banished": [],
              "hand": [
                "Mystical Elf"
              ],
              "lp": 16000
            },
            "p2": {
              "monsters": [
                "Aqua Madoor",
                "Mother Grizzly",
                "Celtic Guardian"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [
                "Penguin Soldier"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            }
          }
        }
      ]
    },
    "watch": "Celtic Guardian",
    "actor": 1,
    "target": 2
  },
  {
    "watch": "Celtic Guardian",
    "actor": 0,
    "target": 2,
    "scenario": {
      "id": "materialization-partner-p0",
      "title": "Materialization retains the summoning duelist",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "action-seat"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            {
              "card": "Materialization",
              "pos": "set"
            }
          ]
        },
        "p2": {
          "spells": [
            "Celtic Guardian"
          ]
        },
        "p1": {},
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
              "monsters": [],
              "spells": [],
              "grave": [
                "Materialization"
              ],
              "banished": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [
                "Celtic Guardian"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            }
          }
        }
      ]
    }
  },
  {
    "watch": "Celtic Guardian",
    "actor": 1,
    "target": 3,
    "scenario": {
      "id": "materialization-partner-p1",
      "title": "Materialization retains the summoning duelist",
      "source": "docs/adr/0002-multiplayer-duel-rules.md",
      "tags": [
        "multiplayer",
        "action-seat"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p1": {
          "spells": [
            {
              "card": "Materialization",
              "pos": "set"
            }
          ]
        },
        "p3": {
          "spells": [
            "Celtic Guardian"
          ]
        },
        "p0": {},
        "p2": {}
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
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Materialization"
              ],
              "banished": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [
                "Celtic Guardian"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            }
          }
        }
      ]
    }
  },
  {
    "scenario": {
      "id": "level-down-stolen-owner-ffa3",
      "title": "level-down-stolen-owner-ffa3",
      "source": "DECISIONS Owner answers 2026-10-02 (afternoon): return to real owner in all tables, Tag too; proposed R-COMMON-RETURN-TO-OWNER",
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
          "hand": [
            "Change of Heart",
            "Level Down!?"
          ]
        },
        "p1": {
          "grave": [
            "Armed Dragon LV3"
          ]
        },
        "p2": {
          "monsters": [
            "Armed Dragon LV5"
          ],
          "grave": [
            "Armed Dragon LV3",
            "Armed Dragon LV3"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Change of Heart",
          "by": "p0"
        },
        {
          "op": "activate",
          "sel": "Level Down!?",
          "by": "p0"
        },
        {
          "op": "zone",
          "by": "p0",
          "owner": "p0",
          "zone": "s1"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "seat": "p2",
              "card": "Armed Dragon LV3"
            },
            {
              "seat": "p2",
              "card": "Armed Dragon LV3"
            }
          ],
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            {
              "card": "Armed Dragon LV3",
              "owner": "p2"
            }
          ],
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Change of Heart",
                "Level Down!?"
              ],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 20
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Armed Dragon LV3"
              ],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 20
            },
            "p2": {
              "monsters": [
                "Armed Dragon LV3"
              ],
              "spells": [],
              "grave": [
                "Armed Dragon LV3"
              ],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 21
            }
          }
        }
      ]
    },
    "watch": "Armed Dragon LV3",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "level-down-stolen-owner-ffa4",
      "title": "level-down-stolen-owner-ffa4",
      "source": "DECISIONS Owner answers 2026-10-02 (afternoon): return to real owner in all tables, Tag too; proposed R-COMMON-RETURN-TO-OWNER",
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
          "hand": [
            "Change of Heart",
            "Level Down!?"
          ]
        },
        "p1": {
          "grave": [
            "Armed Dragon LV3"
          ]
        },
        "p2": {},
        "p3": {
          "monsters": [
            "Armed Dragon LV5"
          ],
          "grave": [
            "Armed Dragon LV3",
            "Armed Dragon LV3"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Change of Heart",
          "by": "p0"
        },
        {
          "op": "activate",
          "sel": "Level Down!?",
          "by": "p0"
        },
        {
          "op": "zone",
          "by": "p0",
          "owner": "p0",
          "zone": "s1"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "seat": "p3",
              "card": "Armed Dragon LV3"
            },
            {
              "seat": "p3",
              "card": "Armed Dragon LV3"
            }
          ],
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            {
              "card": "Armed Dragon LV3",
              "owner": "p3"
            }
          ],
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Change of Heart",
                "Level Down!?"
              ],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 20
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Armed Dragon LV3"
              ],
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
                "Armed Dragon LV3"
              ],
              "spells": [],
              "grave": [
                "Armed Dragon LV3"
              ],
              "banished": [],
              "lp": 8000,
              "hand": [],
              "deckCount": 21
            }
          }
        }
      ]
    },
    "watch": "Armed Dragon LV3",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "level-down-stolen-owner-tag",
      "title": "level-down-stolen-owner-tag",
      "source": "R-TAG-SHARED-CARDS: the named owner or controller shares field and Graveyard with the partner; hand and Deck stay per real seat. DECISIONS: Tag keeps the official TCG Tag rules. Level Down returns LV5 to the real owner Deck and summons to the real owner seat.",
      "tags": [
        "multiplayer",
        "tag",
        "owner-seat-fix"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Change of Heart",
            "Level Down!?"
          ]
        },
        "p1": {
          "grave": [
            "Armed Dragon LV3"
          ]
        },
        "p2": {
          "grave": [
            "Armed Dragon LV3"
          ]
        },
        "p3": {
          "monsters": [
            "Armed Dragon LV5"
          ],
          "grave": [
            "Armed Dragon LV3",
            "Armed Dragon LV3"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Change of Heart",
          "by": "p0"
        },
        {
          "op": "activate",
          "sel": "Level Down!?",
          "by": "p0"
        },
        {
          "op": "zone",
          "by": "p0",
          "owner": "p0",
          "zone": "s1"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "seat": "p1",
              "card": "Armed Dragon LV3"
            },
            {
              "seat": "p3",
              "card": "Armed Dragon LV3"
            },
            {
              "seat": "p3",
              "card": "Armed Dragon LV3"
            }
          ],
          "by": "p0"
        },
        {
          "op": "select",
          "sels": [
            {
              "owner": "p1",
              "card": "Armed Dragon LV3"
            }
          ],
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Change of Heart",
                "Level Down!?"
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
                "Armed Dragon LV3"
              ],
              "banished": [],
              "lp": 16000,
              "hand": [],
              "deckCount": 20
            },
            "p3": {
              "monsters": [
                "Armed Dragon LV3"
              ],
              "spells": [],
              "grave": [
                "Armed Dragon LV3",
                "Armed Dragon LV3"
              ],
              "banished": [],
              "lp": 16000,
              "hand": [],
              "deckCount": 21
            }
          }
        }
      ]
    },
    "watch": "Armed Dragon LV3",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "kaiju-files-two-opponents-ffa3",
      "title": "11163040: use the real card controller or owner for a summon",
      "source": "DECISIONS Owner decisions 2026-10-02 YOUR OPPONENT; R-FFA-OPP-ONE applies to opponent text only; R-COMMON-ALL-BOTH and R-COMMON-OPP-PICK informational hints",
      "tags": [
        "multiplayer",
        "ffa3",
        "card:11163040",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa3",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            "The Kaiju Files"
          ],
          "deck": [
            "Mystical Elf",
            "Gameciel, the Sea Turtle Kaiju",
            "Kumongous, the Sticky String Kaiju"
          ]
        },
        "p2": {
          "monsters": [
            "Dogoran, the Mad Flame Kaiju"
          ]
        },
        "p1": {
          "monsters": [
            "Dogoran, the Mad Flame Kaiju"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "The Kaiju Files",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "by": "p0",
          "options": [
            {
              "seat": "p1",
              "card": "Dogoran, the Mad Flame Kaiju"
            },
            {
              "seat": "p2",
              "card": "Dogoran, the Mad Flame Kaiju"
            }
          ]
        },
        {
          "op": "select",
          "by": "p0",
          "sels": [
            {
              "owner": "p2",
              "card": "Dogoran, the Mad Flame Kaiju"
            }
          ]
        },
        {
          "op": "expectPickOptions",
          "by": "p0",
          "options": [
            {
              "seat": "p0",
              "card": "Gameciel, the Sea Turtle Kaiju"
            },
            {
              "seat": "p0",
              "card": "Kumongous, the Sticky String Kaiju"
            }
          ]
        },
        {
          "op": "select",
          "by": "p0",
          "sels": [
            "Gameciel, the Sea Turtle Kaiju"
          ]
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [
                "The Kaiju Files"
              ],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [
                "Dogoran, the Mad Flame Kaiju"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [
                "Gameciel, the Sea Turtle Kaiju"
              ],
              "spells": [],
              "grave": [
                "Dogoran, the Mad Flame Kaiju"
              ],
              "banished": [],
              "hand": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Gameciel, the Sea Turtle Kaiju",
    "actor": 0,
    "target": 2
  },
  {
    "scenario": {
      "id": "kaiju-files-two-opponents-ffa4",
      "title": "11163040: use the real card controller or owner for a summon",
      "source": "DECISIONS Owner decisions 2026-10-02 YOUR OPPONENT; R-FFA-OPP-ONE applies to opponent text only; R-COMMON-ALL-BOTH and R-COMMON-OPP-PICK informational hints",
      "tags": [
        "multiplayer",
        "ffa4",
        "card:11163040",
        "stock-standard-opening-draw"
      ],
      "setup": {
        "format": "ffa4",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            "The Kaiju Files"
          ],
          "deck": [
            "Mystical Elf",
            "Gameciel, the Sea Turtle Kaiju",
            "Kumongous, the Sticky String Kaiju"
          ]
        },
        "p3": {
          "monsters": [
            "Dogoran, the Mad Flame Kaiju"
          ]
        },
        "p1": {
          "monsters": [
            "Dogoran, the Mad Flame Kaiju"
          ]
        },
        "p2": {}
      },
      "steps": [
        {
          "op": "activate",
          "sel": "The Kaiju Files",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "by": "p0",
          "options": [
            {
              "seat": "p1",
              "card": "Dogoran, the Mad Flame Kaiju"
            },
            {
              "seat": "p3",
              "card": "Dogoran, the Mad Flame Kaiju"
            }
          ]
        },
        {
          "op": "select",
          "by": "p0",
          "sels": [
            {
              "owner": "p3",
              "card": "Dogoran, the Mad Flame Kaiju"
            }
          ]
        },
        {
          "op": "expectPickOptions",
          "by": "p0",
          "options": [
            {
              "seat": "p0",
              "card": "Gameciel, the Sea Turtle Kaiju"
            },
            {
              "seat": "p0",
              "card": "Kumongous, the Sticky String Kaiju"
            }
          ]
        },
        {
          "op": "select",
          "by": "p0",
          "sels": [
            "Gameciel, the Sea Turtle Kaiju"
          ]
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [
                "The Kaiju Files"
              ],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p1": {
              "monsters": [
                "Dogoran, the Mad Flame Kaiju"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p2": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 8000
            },
            "p3": {
              "monsters": [
                "Gameciel, the Sea Turtle Kaiju"
              ],
              "spells": [],
              "grave": [
                "Dogoran, the Mad Flame Kaiju"
              ],
              "banished": [],
              "hand": [],
              "lp": 8000
            }
          }
        }
      ]
    },
    "watch": "Gameciel, the Sea Turtle Kaiju",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "kaiju-files-two-fields-tag",
      "title": "11163040: use the real card controller or owner for a summon",
      "source": "DECISIONS Owner decisions 2026-10-02 YOUR OPPONENT; R-FFA-OPP-ONE applies to opponent text only; R-COMMON-ALL-BOTH and R-COMMON-OPP-PICK informational hints",
      "tags": [
        "multiplayer",
        "tag",
        "card:11163040"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "spells": [
            "The Kaiju Files"
          ],
          "deck": [
            "Gameciel, the Sea Turtle Kaiju",
            "Kumongous, the Sticky String Kaiju"
          ]
        },
        "p3": {
          "monsters": [
            "Dogoran, the Mad Flame Kaiju"
          ]
        },
        "p1": {},
        "p2": {
          "monsters": [
            "Dogoran, the Mad Flame Kaiju"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "The Kaiju Files",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "by": "p0",
          "options": [
            {
              "seat": "p2",
              "card": "Dogoran, the Mad Flame Kaiju"
            },
            {
              "seat": "p3",
              "card": "Dogoran, the Mad Flame Kaiju"
            }
          ]
        },
        {
          "op": "select",
          "by": "p0",
          "sels": [
            {
              "owner": "p3",
              "card": "Dogoran, the Mad Flame Kaiju"
            }
          ]
        },
        {
          "op": "expectPickOptions",
          "by": "p0",
          "options": [
            {
              "seat": "p0",
              "card": "Gameciel, the Sea Turtle Kaiju"
            },
            {
              "seat": "p0",
              "card": "Kumongous, the Sticky String Kaiju"
            }
          ]
        },
        {
          "op": "select",
          "by": "p0",
          "sels": [
            "Gameciel, the Sea Turtle Kaiju"
          ]
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [
                "The Kaiju Files"
              ],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [
                "Dogoran, the Mad Flame Kaiju"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "hand": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [
                "Gameciel, the Sea Turtle Kaiju"
              ],
              "spells": [],
              "grave": [
                "Dogoran, the Mad Flame Kaiju"
              ],
              "banished": [],
              "hand": [],
              "lp": 16000
            }
          }
        }
      ]
    },
    "watch": "Gameciel, the Sea Turtle Kaiju",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "zealantis-confirm-once-ffa3",
      "title": "Zealantis returns face down and confirms once per opponent",
      "source": "R-COMMON-ALL-BOTH; ConfirmCards raises one reveal event per group",
      "setup": {
        "format": "ffa3",
        "p0": {
          "monsters": [
            "Worldsea Dragon Zealantis"
          ]
        },
        "p1": {},
        "p2": {
          "monsters": [
            "Battle Ox"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Worldsea Dragon Zealantis",
          "by": "p0"
        },
        {
          "op": "zone",
          "owner": "p0",
          "zone": "m0",
          "by": "p0"
        },
        {
          "op": "zone",
          "owner": "p2",
          "zone": "m0",
          "by": "p0"
        },
        {
          "op": "position",
          "pos": "set",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "lp": 8000,
              "hand": [],
              "deckCount": 20,
              "spells": [],
              "grave": [],
              "banished": [],
              "monsters": [
                "Worldsea Dragon Zealantis"
              ]
            },
            "p1": {
              "lp": 8000,
              "hand": [],
              "deckCount": 20,
              "spells": [],
              "grave": [],
              "banished": [],
              "monsters": []
            },
            "p2": {
              "lp": 8000,
              "hand": [],
              "deckCount": 20,
              "spells": [],
              "grave": [],
              "banished": [],
              "monsters": [
                "Battle Ox"
              ],
              "zones": {
                "m0": {
                  "card": "Battle Ox",
                  "pos": "facedown"
                }
              }
            }
          }
        }
      ],
      "tags": [
        "multiplayer",
        "ffa3",
        "card:45112597",
        "action-seat",
        "confirm-once",
        "stock-standard-opening-draw"
      ]
    },
    "watch": "Battle Ox",
    "actor": 0,
    "target": 2,
    "banish": [
      2
    ],
    "confirm": true
  },
  {
    "scenario": {
      "id": "zealantis-confirm-once-ffa4",
      "title": "Zealantis returns face down and confirms once per opponent",
      "source": "R-COMMON-ALL-BOTH; ConfirmCards raises one reveal event per group",
      "setup": {
        "format": "ffa4",
        "p0": {
          "monsters": [
            "Worldsea Dragon Zealantis"
          ]
        },
        "p1": {},
        "p2": {},
        "p3": {
          "monsters": [
            "Battle Ox"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Worldsea Dragon Zealantis",
          "by": "p0"
        },
        {
          "op": "zone",
          "owner": "p0",
          "zone": "m0",
          "by": "p0"
        },
        {
          "op": "zone",
          "owner": "p3",
          "zone": "m0",
          "by": "p0"
        },
        {
          "op": "position",
          "pos": "set",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "lp": 8000,
              "hand": [],
              "deckCount": 20,
              "spells": [],
              "grave": [],
              "banished": [],
              "monsters": [
                "Worldsea Dragon Zealantis"
              ]
            },
            "p1": {
              "lp": 8000,
              "hand": [],
              "deckCount": 20,
              "spells": [],
              "grave": [],
              "banished": [],
              "monsters": []
            },
            "p2": {
              "lp": 8000,
              "hand": [],
              "deckCount": 20,
              "spells": [],
              "grave": [],
              "banished": [],
              "monsters": []
            },
            "p3": {
              "lp": 8000,
              "hand": [],
              "deckCount": 20,
              "spells": [],
              "grave": [],
              "banished": [],
              "monsters": [
                "Battle Ox"
              ],
              "zones": {
                "m0": {
                  "card": "Battle Ox",
                  "pos": "facedown"
                }
              }
            }
          }
        }
      ],
      "tags": [
        "multiplayer",
        "ffa4",
        "card:45112597",
        "action-seat",
        "confirm-once",
        "stock-standard-opening-draw"
      ]
    },
    "watch": "Battle Ox",
    "actor": 0,
    "target": 3,
    "banish": [
      3
    ],
    "confirm": true
  },
  {
    "scenario": {
      "id": "zealantis-confirm-once-tag",
      "title": "Zealantis returns face down and confirms once per opponent",
      "source": "R-COMMON-ALL-BOTH; ConfirmCards raises one reveal event per group",
      "setup": {
        "format": "tag",
        "p0": {
          "monsters": [
            "Worldsea Dragon Zealantis"
          ]
        },
        "p1": {},
        "p2": {},
        "p3": {
          "monsters": [
            "Battle Ox"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Worldsea Dragon Zealantis",
          "by": "p0"
        },
        {
          "op": "zone",
          "owner": "p0",
          "zone": "m0",
          "by": "p0"
        },
        {
          "op": "zone",
          "owner": "p3",
          "zone": "m0",
          "by": "p0"
        },
        {
          "op": "position",
          "pos": "set",
          "by": "p0"
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "lp": 16000,
              "hand": [],
              "deckCount": 20,
              "spells": [],
              "grave": [],
              "banished": [],
              "monsters": [
                "Worldsea Dragon Zealantis"
              ]
            },
            "p1": {
              "lp": 16000,
              "hand": [],
              "deckCount": 20,
              "spells": [],
              "grave": [],
              "banished": [],
              "monsters": []
            },
            "p2": {
              "lp": 16000,
              "hand": [],
              "deckCount": 20,
              "spells": [],
              "grave": [],
              "banished": [],
              "monsters": []
            },
            "p3": {
              "lp": 16000,
              "hand": [],
              "deckCount": 20,
              "spells": [],
              "grave": [],
              "banished": [],
              "monsters": [
                "Battle Ox"
              ],
              "zones": {
                "m0": {
                  "card": "Battle Ox",
                  "pos": "facedown"
                }
              }
            }
          }
        }
      ],
      "tags": [
        "multiplayer",
        "tag",
        "card:45112597",
        "action-seat",
        "confirm-once"
      ]
    },
    "watch": "Battle Ox",
    "actor": 0,
    "target": 3,
    "banish": [
      3
    ],
    "confirm": true
  },
  {
    "scenario": {
      "id": "hydor-owner-tag-owner-full-control",
      "title": "Hydor cannot free an owner zone by destroying a partner WATER monster",
      "source": "R-TAG-SHARED-CARDS: the named owner or controller shares field and Graveyard with the partner; hand and Deck stay per real seat. DECISIONS: Tag keeps the official TCG Tag rules. Hydor checks free zones and summons at the real owner seat.",
      "tags": [
        "multiplayer",
        "tag",
        "card:30339825"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Hydor, the Base of All Things"
          ]
        },
        "p3": {
          "grave": [
            "Celtic Guardian"
          ],
          "monsters": [
            "Aqua Madoor",
            "Mother Grizzly",
            "Battle Ox",
            "Mystical Elf",
            "Silver Fang"
          ]
        },
        "p1": {
          "monsters": [
            "Penguin Soldier"
          ]
        },
        "p2": {
          "monsters": [
            "Penguin Soldier"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Hydor, the Base of All Things",
          "by": "p0"
        },
        {
          "op": "zone",
          "owner": "p0",
          "zone": "s0",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "seat": "p3",
              "card": "Aqua Madoor"
            },
            {
              "seat": "p3",
              "card": "Mother Grizzly"
            }
          ],
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "title": "Select the card(s) to destroy"
          }
        },
        {
          "op": "select",
          "sels": [
            {
              "owner": "p3",
              "card": "Aqua Madoor"
            }
          ]
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Hydor, the Base of All Things"
              ],
              "banished": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [
                "Penguin Soldier"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [
                "Penguin Soldier"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [
                "Mother Grizzly",
                "Battle Ox",
                "Mystical Elf",
                "Silver Fang",
                "Celtic Guardian"
              ],
              "spells": [],
              "grave": [
                "Aqua Madoor"
              ],
              "banished": [],
              "lp": 16000
            }
          }
        }
      ]
    },
    "watch": "Celtic Guardian",
    "actor": 0,
    "target": 3
  },
  {
    "scenario": {
      "id": "hydor-owner-tag-owner-room-partner-full",
      "title": "Hydor can destroy a partner WATER monster when the owner has free zones",
      "source": "R-TAG-SHARED-CARDS: the named owner or controller shares field and Graveyard with the partner; hand and Deck stay per real seat. DECISIONS: Tag keeps the official TCG Tag rules. Hydor checks free zones and summons at the real owner seat.",
      "tags": [
        "multiplayer",
        "tag",
        "card:30339825"
      ],
      "setup": {
        "format": "tag",
        "attackFirstTurn": true,
        "p0": {
          "hand": [
            "Hydor, the Base of All Things"
          ]
        },
        "p3": {
          "grave": [
            "Celtic Guardian"
          ],
          "monsters": [
            "Aqua Madoor",
            "Mother Grizzly"
          ]
        },
        "p1": {
          "monsters": [
            "Penguin Soldier",
            "Battle Ox",
            "Mystical Elf",
            "Silver Fang",
            "Celtic Guardian"
          ]
        },
        "p2": {
          "monsters": [
            "Penguin Soldier"
          ]
        }
      },
      "steps": [
        {
          "op": "activate",
          "sel": "Hydor, the Base of All Things",
          "by": "p0"
        },
        {
          "op": "zone",
          "owner": "p0",
          "zone": "s0",
          "by": "p0"
        },
        {
          "op": "expectPickOptions",
          "options": [
            {
              "seat": "p3",
              "card": "Aqua Madoor"
            },
            {
              "seat": "p3",
              "card": "Mother Grizzly"
            },
            {
              "seat": "p1",
              "card": "Penguin Soldier"
            }
          ],
          "by": "p0"
        },
        {
          "op": "expectPrompt",
          "prompt": {
            "by": "p0",
            "title": "Select the card(s) to destroy"
          }
        },
        {
          "op": "select",
          "sels": [
            {
              "owner": "p1",
              "card": "Penguin Soldier"
            }
          ]
        },
        {
          "op": "expectBoard",
          "board": {
            "p0": {
              "monsters": [],
              "spells": [],
              "grave": [
                "Hydor, the Base of All Things"
              ],
              "banished": [],
              "lp": 16000
            },
            "p1": {
              "monsters": [
                "Battle Ox",
                "Mystical Elf",
                "Silver Fang",
                "Celtic Guardian"
              ],
              "spells": [],
              "grave": [
                "Penguin Soldier"
              ],
              "banished": [],
              "lp": 16000
            },
            "p2": {
              "monsters": [
                "Penguin Soldier"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            },
            "p3": {
              "monsters": [
                "Aqua Madoor",
                "Mother Grizzly",
                "Celtic Guardian"
              ],
              "spells": [],
              "grave": [],
              "banished": [],
              "lp": 16000
            }
          }
        }
      ]
    },
    "watch": "Celtic Guardian",
    "actor": 0,
    "target": 3
  }
];
