// Generated from Metaphone 0.6 by generate-phonetics.py. See METAPHONE-LICENSE.
// Only called with clean()'s ASCII input; retain Python's decision rules exactly.
class Word {
  constructor(input) {
    const upper = input.toUpperCase();
    this.start_index = 2;
    this.end_index = upper.length + 1;
    this.buffer = '--' + upper + '------';
    this.is_slavo_germanic = /W|K|CZ|WITZ/.test(upper);
  }
  get_letters(start = 0, end = start + 1) {
    return this.buffer.slice(this.start_index + start, this.start_index + end);
  }
}
const VOWELS = ['A', 'E', 'I', 'O', 'U', 'Y'];
const SILENT_STARTERS = ['GN', 'KN', 'PN', 'WR', 'PS'];
class DoubleMetaphone {
  constructor() {
    this.position = 0;
    this.primary_phone = "";
    this.secondary_phone = "";
    this.next = [null, 1];
  }
  check_word_start() {
    if (SILENT_STARTERS.includes(this.word.get_letters(0, 2))) {
      this.position += 1;
    }
    if (this.word.get_letters(0) === "X") {
      this.primary_phone = this.secondary_phone = "S";
      this.position += 1;
    }
  }
  process_initial_vowels() {
    this.next = [null, 1];
    if (this.position === this.word.start_index) {
      this.next = ["A", 1];
    }
  }
  process_b() {
    if (this.word.buffer[(this.position + 1)] === "B") {
      this.next = ["P", 2];
    } else {
      this.next = ["P", 1];
    }
  }
  process_c() {
    let buffer, position, start_index;
    buffer = this.word.buffer;
    position = this.position;
    start_index = this.word.start_index;
    if ((position > (start_index + 1) && !VOWELS.includes(buffer[(position - 2)]) && buffer.slice((position - 1), (this.position + 2)) === "ACH" && !["I"].includes(buffer[(position + 2)]) && (!["E"].includes(buffer[(position + 2)]) || ["BACHER", "MACHER"].includes(buffer.slice((position - 2), (position + 4)))))) {
      this.next = ["K", 2];
    } else {
      if ((position === start_index && buffer.slice(start_index, (start_index + 6)) === "CAESAR")) {
        this.next = ["S", 2];
      } else {
        if (buffer.slice(position, (position + 4)) === "CHIA") {
          this.next = ["K", 2];
        } else {
          if (buffer.slice(position, (position + 2)) === "CH") {
            if ((position > start_index && buffer.slice(position, (position + 4)) === "CHAE")) {
              this.next = ["K", "X", 2];
            } else {
              if ((position === start_index && (["HARAC", "HARIS"].includes(buffer.slice((position + 1), (position + 6))) || ["HOR", "HYM", "HIA", "HEM"].includes(buffer.slice((position + 1), (position + 4)))) && buffer.slice(start_index, (start_index + 5)) !== "CHORE")) {
                this.next = ["K", 2];
              } else {
                if ((["VAN ", "VON "].includes(buffer.slice(start_index, (start_index + 4))) || buffer.slice(start_index, (start_index + 3)) === "SCH" || ["ORCHES", "ARCHIT", "ORCHID"].includes(buffer.slice((position - 2), (position + 4))) || ["T", "S"].includes(buffer[(position + 2)]) || ((["A", "O", "U", "E"].includes(buffer[(position - 1)]) || position === start_index) && ["L", "R", "N", "M", "B", "H", "F", "V", "W"].includes(buffer[(position + 2)])))) {
                  this.next = ["K", 2];
                } else {
                  if (position > start_index) {
                    if (buffer.slice(start_index, (start_index + 2)) === "MC") {
                      this.next = ["K", 2];
                    } else {
                      this.next = ["X", "K", 2];
                    }
                  } else {
                    this.next = ["X", 2];
                  }
                }
              }
            }
          } else {
            if ((buffer.slice(position, (position + 2)) === "CZ" && buffer.slice((position - 2), (position + 2)) !== "WICZ")) {
              this.next = ["S", "X", 2];
            } else {
              if (buffer.slice((position + 1), (position + 4)) === "CIA") {
                this.next = ["X", 3];
              } else {
                if ((buffer.slice(position, (position + 2)) === "CC" && !((position === (start_index + 1) && buffer[start_index] === "M")))) {
                  if ((["I", "E", "H"].includes(buffer[(position + 2)]) && buffer.slice((position + 2), (position + 4)) !== "HU")) {
                    if (((position === (start_index + 1) && buffer[start_index] === "A") || ["UCCEE", "UCCES"].includes(buffer.slice((position - 1), (position + 4))))) {
                      this.next = ["KS", 3];
                    } else {
                      this.next = ["X", 3];
                    }
                  } else {
                    this.next = ["K", 2];
                  }
                } else {
                  if (["CK", "CG", "CQ"].includes(buffer.slice(position, (position + 2)))) {
                    this.next = ["K", 2];
                  } else {
                    if (["CI", "CE", "CY"].includes(buffer.slice(position, (position + 2)))) {
                      if (["CIO", "CIE", "CIA"].includes(buffer.slice(position, (position + 3)))) {
                        this.next = ["S", "X", 2];
                      } else {
                        this.next = ["S", 2];
                      }
                    } else {
                      if ([" C", " Q", " G"].includes(buffer.slice((position + 1), (position + 3)))) {
                        this.next = ["K", 3];
                      } else {
                        if ((["C", "K", "Q"].includes(buffer[(position + 1)]) && !["CE", "CI"].includes(buffer.slice((position + 1), (position + 3))))) {
                          this.next = ["K", 2];
                        } else {
                          this.next = ["K", 1];
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  process_d() {
    if (this.word.buffer.slice(this.position, (this.position + 2)) === "DG") {
      if (["I", "E", "Y"].includes(this.word.buffer[(this.position + 2)])) {
        this.next = ["J", 3];
      } else {
        this.next = ["TK", 2];
      }
    } else {
      if (["DT", "DD"].includes(this.word.buffer.slice(this.position, (this.position + 2)))) {
        this.next = ["T", 2];
      } else {
        this.next = ["T", 1];
      }
    }
  }
  process_f() {
    if (this.word.buffer[(this.position + 1)] === "F") {
      this.next = ["F", 2];
    } else {
      this.next = ["F", 1];
    }
  }
  process_g() {
    let buffer, position, start_index;
    buffer = this.word.buffer;
    position = this.position;
    start_index = this.word.start_index;
    if (buffer[(position + 1)] === "H") {
      if ((position > start_index && !VOWELS.includes(buffer[(position - 1)]))) {
        this.next = ["K", 2];
      } else {
        if (position < (start_index + 3)) {
          if (position === start_index) {
            if (buffer[(position + 2)] === "I") {
              this.next = ["J", 2];
            } else {
              this.next = ["K", 2];
            }
          }
        } else {
          if (((position > (start_index + 1) && ["B", "H", "D"].includes(buffer[(position - 2)])) || (position > (start_index + 2) && ["B", "H", "D"].includes(buffer[(position - 3)])) || (position > (start_index + 3) && ["B", "H"].includes(buffer[(position - 4)])))) {
            this.next = [null, 2];
          } else {
            if ((position > (start_index + 2) && buffer[(position - 1)] === "U" && ["C", "G", "L", "R", "T"].includes(buffer[(position - 3)]))) {
              this.next = ["F", 2];
            } else {
              if ((position > start_index && buffer[(position - 1)] !== "I")) {
                this.next = ["K", 2];
              }
            }
          }
        }
      }
    } else {
      if (buffer[(position + 1)] === "N") {
        if ((position === (start_index + 1) && VOWELS.includes(buffer[start_index]) && !(this.word.is_slavo_germanic))) {
          this.next = ["KN", "N", 2];
        } else {
          if ((buffer.slice((position + 2), (position + 4)) !== "EY" && buffer[(position + 1)] !== "Y" && !(this.word.is_slavo_germanic))) {
            this.next = ["N", "KN", 2];
          } else {
            this.next = ["KN", 2];
          }
        }
      } else {
        if ((buffer.slice((position + 1), (position + 3)) === "LI" && !(this.word.is_slavo_germanic))) {
          this.next = ["KL", "L", 2];
        } else {
          if ((position === start_index && (buffer[(position + 1)] === "Y" || ["ES", "EP", "EB", "EL", "EY", "IB", "IL", "IN", "IE", "EI", "ER"].includes(buffer.slice((position + 1), (position + 3)))))) {
            this.next = ["K", "J", 2];
          } else {
            if (((buffer.slice((position + 1), (position + 3)) === "ER" || buffer[(position + 1)] === "Y") && !["DANGER", "RANGER", "MANGER"].includes(buffer.slice(start_index, (start_index + 6))) && !["E", "I"].includes(buffer[(position - 1)]) && !["RGY", "OGY"].includes(buffer.slice((position - 1), (position + 2))))) {
              this.next = ["K", "J", 2];
            } else {
              if ((["E", "I", "Y"].includes(buffer[(position + 1)]) || ["AGGI", "OGGI"].includes(buffer.slice((position - 1), (position + 3))))) {
                if ((["VON ", "VAN "].includes(buffer.slice(start_index, (start_index + 4))) || buffer.slice(start_index, (start_index + 3)) === "SCH" || buffer.slice((position + 1), (position + 3)) === "ET")) {
                  this.next = ["K", 2];
                } else {
                  if (buffer.slice((position + 1), (position + 5)) === "IER ") {
                    this.next = ["J", 2];
                  } else {
                    this.next = ["J", "K", 2];
                  }
                }
              } else {
                if (buffer[(position + 1)] === "G") {
                  this.next = ["K", 2];
                } else {
                  this.next = ["K", 1];
                }
              }
            }
          }
        }
      }
    }
  }
  process_h() {
    if (((this.position === this.word.start_index || VOWELS.includes(this.word.buffer[(this.position - 1)])) && VOWELS.includes(this.word.buffer[(this.position + 1)]))) {
      this.next = ["H", 2];
    } else {
      this.next = [null, 1];
    }
  }
  process_j() {
    let buffer, position, start_index;
    buffer = this.word.buffer;
    position = this.position;
    start_index = this.word.start_index;
    if ((buffer.slice(this.position, (this.position + 4)) === "JOSE" || buffer.slice(start_index, (start_index + 4)) === "SAN ")) {
      if (((position === start_index && buffer[(position + 4)] === " ") || buffer.slice(start_index, (start_index + 4)) === "SAN ")) {
        this.next = ["H"];
      } else {
        this.next = ["J", "H"];
      }
    } else {
      if ((position === start_index && buffer.slice(this.position, (this.position + 4)) !== "JOSE")) {
        this.next = ["J", "A"];
      } else {
        if ((VOWELS.includes(buffer[(position - 1)]) && !(this.word.is_slavo_germanic) && ["A", "O"].includes(buffer[(position + 1)]))) {
          this.next = ["J", "H"];
        } else {
          if (position === this.word.end_index) {
            this.next = ["J", " "];
          } else {
            if ((!["L", "T", "K", "S", "N", "M", "B", "Z"].includes(buffer[(position + 1)]) && !["S", "K", "L"].includes(buffer[(position - 1)]))) {
              this.next = ["J"];
            } else {
              this.next = [null];
            }
          }
        }
      }
    }
    if (buffer[(position + 1)] === "J") {
      this.next = this.next.concat([2]);
    } else {
      this.next = this.next.concat([1]);
    }
  }
  process_k() {
    if (this.word.buffer[(this.position + 1)] === "K") {
      this.next = ["K", 2];
    } else {
      this.next = ["K", 1];
    }
  }
  process_l() {
    let buffer, end_index, position;
    buffer = this.word.buffer;
    position = this.position;
    end_index = this.word.end_index;
    if (buffer[(position + 1)] === "L") {
      if (((position === (end_index - 2) && ["ILLO", "ILLA", "ALLE"].includes(buffer.slice((position - 1), (position + 3)))) || ((["AS", "OS"].includes(buffer.slice((end_index - 1), (end_index + 1))) || ["A", "O"].includes(buffer[end_index])) && buffer.slice((position - 1), (position + 3)) === "ALLE"))) {
        this.next = ["L", "", 2];
      } else {
        this.next = ["L", 2];
      }
    } else {
      this.next = ["L", 1];
    }
  }
  process_m() {
    let buffer, position;
    buffer = this.word.buffer;
    position = this.position;
    if (((buffer.slice((position + 1), (position + 4)) === "UMB" && ((position + 1) === this.word.end_index || buffer.slice((position + 2), (position + 4)) === "ER")) || buffer[(position + 1)] === "M")) {
      this.next = ["M", 2];
    } else {
      this.next = ["M", 1];
    }
  }
  process_n() {
    if (this.word.buffer[(this.position + 1)] === "N") {
      this.next = ["N", 2];
    } else {
      this.next = ["N", 1];
    }
  }
  process_p() {
    if (this.word.buffer[(this.position + 1)] === "H") {
      this.next = ["F", 2];
    } else {
      if (["P", "B"].includes(this.word.buffer[(this.position + 1)])) {
        this.next = ["P", 2];
      } else {
        this.next = ["P", 1];
      }
    }
  }
  process_q() {
    if (this.word.buffer[(this.position + 1)] === "Q") {
      this.next = ["K", 2];
    } else {
      this.next = ["K", 1];
    }
  }
  process_r() {
    let buffer, end_index, position;
    buffer = this.word.buffer;
    position = this.position;
    end_index = this.word.end_index;
    if ((position === end_index && !(this.word.is_slavo_germanic) && buffer.slice((position - 2), position) === "IE" && !["ME", "MA"].includes(buffer.slice((position - 4), (position - 2))))) {
      this.next = ["", "R"];
    } else {
      this.next = ["R"];
    }
    if (buffer[(position + 1)] === "R") {
      this.next = this.next.concat([2]);
    } else {
      this.next = this.next.concat([1]);
    }
  }
  process_s() {
    let buffer, end_index, position, start_index;
    buffer = this.word.buffer;
    position = this.position;
    start_index = this.word.start_index;
    end_index = this.word.end_index;
    if (["ISL", "YSL"].includes(buffer.slice((position - 1), (position + 2)))) {
      this.next = [null, 1];
    } else {
      if ((position === start_index && buffer.slice(start_index, (start_index + 5)) === "SUGAR")) {
        this.next = ["X", "S", 1];
      } else {
        if (buffer.slice(position, (position + 2)) === "SH") {
          if (["HEIM", "HOEK", "HOLM", "HOLZ"].includes(buffer.slice((position + 1), (position + 5)))) {
            this.next = ["S", 2];
          } else {
            this.next = ["X", 2];
          }
        } else {
          if ((["SIO", "SIA"].includes(buffer.slice(position, (position + 3))) || buffer.slice(position, (position + 4)) === "SIAN")) {
            if (!(this.word.is_slavo_germanic)) {
              this.next = ["S", "X", 3];
            } else {
              this.next = ["S", 3];
            }
          } else {
            if (((position === start_index && ["M", "N", "L", "W"].includes(buffer[(position + 1)])) || buffer[(position + 1)] === "Z")) {
              this.next = ["S", "X"];
              if (buffer[(position + 1)] === "Z") {
                this.next = this.next.concat([2]);
              } else {
                this.next = this.next.concat([1]);
              }
            } else {
              if (buffer.slice(position, (position + 2)) === "SC") {
                if (buffer[(position + 2)] === "H") {
                  if (["OO", "ER", "EN", "UY", "ED", "EM"].includes(buffer.slice((position + 3), (position + 5)))) {
                    if (["ER", "EN"].includes(buffer.slice((position + 3), (position + 5)))) {
                      this.next = ["X", "SK", 3];
                    } else {
                      this.next = ["SK", 3];
                    }
                  } else {
                    if ((position === start_index && !VOWELS.includes(buffer[(start_index + 3)]) && buffer[(start_index + 3)] !== "W")) {
                      this.next = ["X", "S", 3];
                    } else {
                      this.next = ["X", 3];
                    }
                  }
                } else {
                  if (["I", "E", "Y"].includes(buffer[(position + 2)])) {
                    this.next = ["S", 3];
                  } else {
                    this.next = ["SK", 3];
                  }
                }
              } else {
                if ((position === end_index && ["AI", "OI"].includes(buffer.slice((position - 2), position)))) {
                  this.next = ["", "S", 1];
                } else {
                  this.next = ["S"];
                  if (["S", "Z"].includes(buffer[(position + 1)])) {
                    this.next = this.next.concat([2]);
                  } else {
                    this.next = this.next.concat([1]);
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  process_t() {
    let buffer, position, start_index;
    buffer = this.word.buffer;
    position = this.position;
    start_index = this.word.start_index;
    if (buffer.slice(position, (position + 4)) === "TION") {
      this.next = ["X", 3];
    } else {
      if (["TIA", "TCH"].includes(buffer.slice(position, (position + 3)))) {
        this.next = ["X", 3];
      } else {
        if ((buffer.slice(position, (position + 2)) === "TH" || buffer.slice(position, (position + 3)) === "TTH")) {
          if ((["OM", "AM"].includes(buffer.slice((position + 2), (position + 4))) || ["VON ", "VAN "].includes(buffer.slice(start_index, (start_index + 4))) || buffer.slice(start_index, (start_index + 3)) === "SCH")) {
            this.next = ["T", 2];
          } else {
            this.next = ["0", "T", 2];
          }
        } else {
          if (["T", "D"].includes(buffer[(position + 1)])) {
            this.next = ["T", 2];
          } else {
            this.next = ["T", 1];
          }
        }
      }
    }
  }
  process_v() {
    if (this.word.buffer[(this.position + 1)] === "V") {
      this.next = ["F", 2];
    } else {
      this.next = ["F", 1];
    }
  }
  process_w() {
    let buffer, position, start_index;
    buffer = this.word.buffer;
    position = this.position;
    start_index = this.word.start_index;
    if (buffer.slice(position, (position + 2)) === "WR") {
      this.next = ["R", 2];
    } else {
      if ((position === start_index && (VOWELS.includes(buffer[(position + 1)]) || buffer.slice(position, (position + 2)) === "WH"))) {
        if (VOWELS.includes(buffer[(position + 1)])) {
          this.next = ["A", "F", 1];
        } else {
          this.next = ["A", 1];
        }
      } else {
        if (((position === this.word.end_index && VOWELS.includes(buffer[(position - 1)])) || ["EWSKI", "EWSKY", "OWSKI", "OWSKY"].includes(buffer.slice((position - 1), (position + 4))) || buffer.slice(start_index, (start_index + 3)) === "SCH")) {
          this.next = ["", "F", 1];
        } else {
          if (["WICZ", "WITZ"].includes(buffer.slice(position, (position + 4)))) {
            this.next = ["TS", "FX", 4];
          } else {
            this.next = [null, 1];
          }
        }
      }
    }
  }
  process_x() {
    let buffer, position;
    buffer = this.word.buffer;
    position = this.position;
    this.next = [null];
    if (!((position === this.word.end_index && (["IAU", "EAU"].includes(buffer.slice((position - 3), position)) || ["AU", "OU"].includes(buffer.slice((position - 2), position)))))) {
      this.next = ["KS"];
    }
    if (["C", "X"].includes(buffer[(position + 1)])) {
      this.next = this.next.concat([2]);
    } else {
      this.next = this.next.concat([1]);
    }
  }
  process_z() {
    if (this.word.buffer[(this.position + 1)] === "H") {
      this.next = ["J"];
    } else {
      if ((["ZO", "ZI", "ZA"].includes(this.word.buffer.slice((this.position + 1), (this.position + 3))) || (this.word.is_slavo_germanic && this.position > this.word.start_index && this.word.buffer[(this.position - 1)] !== "T"))) {
        this.next = ["S", "TS"];
      } else {
        this.next = ["S"];
      }
    }
    if ((this.word.buffer[(this.position + 1)] === "Z" || this.word.buffer[(this.position + 1)] === "H")) {
      this.next = this.next.concat([2]);
    } else {
      this.next = this.next.concat([1]);
    }
  }
  parse(input) {
    let character;
    this.word = new Word(input);
    this.position = this.word.start_index;
    this.check_word_start();
    while (this.position <= this.word.end_index) {
      character = this.word.buffer[this.position];
      if (VOWELS.includes(character)) {
        this.process_initial_vowels();
      } else {
        if (character === " ") {
          this.position += 1;
          continue;
        } else {
          if (character === "B") {
            this.process_b();
          } else {
            if (character === "C") {
              this.process_c();
            } else {
              if (character === "D") {
                this.process_d();
              } else {
                if (character === "F") {
                  this.process_f();
                } else {
                  if (character === "G") {
                    this.process_g();
                  } else {
                    if (character === "H") {
                      this.process_h();
                    } else {
                      if (character === "J") {
                        this.process_j();
                      } else {
                        if (character === "K") {
                          this.process_k();
                        } else {
                          if (character === "L") {
                            this.process_l();
                          } else {
                            if (character === "M") {
                              this.process_m();
                            } else {
                              if (character === "N") {
                                this.process_n();
                              } else {
                                if (character === "P") {
                                  this.process_p();
                                } else {
                                  if (character === "Q") {
                                    this.process_q();
                                  } else {
                                    if (character === "R") {
                                      this.process_r();
                                    } else {
                                      if (character === "S") {
                                        this.process_s();
                                      } else {
                                        if (character === "T") {
                                          this.process_t();
                                        } else {
                                          if (character === "V") {
                                            this.process_v();
                                          } else {
                                            if (character === "W") {
                                              this.process_w();
                                            } else {
                                              if (character === "X") {
                                                this.process_x();
                                              } else {
                                                if (character === "Z") {
                                                  this.process_z();
                                                }
                                              }
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      if (this.next.length === 2) {
        if (this.next[0]) {
          this.primary_phone += this.next[0];
          this.secondary_phone += this.next[0];
        }
        this.position += this.next[1];
      } else {
        if (this.next.length === 3) {
          if (this.next[0]) {
            this.primary_phone += this.next[0];
          }
          if (this.next[1]) {
            this.secondary_phone += this.next[1];
          }
          this.position += this.next[2];
        }
      }
    }
    if (this.primary_phone === this.secondary_phone) {
      this.secondary_phone = "";
    }
    return [this.primary_phone, this.secondary_phone];
  }
}
export function doubleMetaphone(text) { return new DoubleMetaphone().parse(text); }
