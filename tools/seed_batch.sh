#!/usr/bin/env bash
# Batch Seedance idle+attack animation baker for the enemy roster.
# For each enemy: generate a loopable idle clip + an idle->attack tween,
# then key both back to transparent square sprite sheets in public/sprites/.
# Usage: bash tools/seed_batch.sh   (runs every enemy below, skipping any whose
# sheets already exist so it's safe to re-run / resume).
set -u
cd "$(dirname "$0")/.."

gen() {
  key="$1"; idle_src="$2"; atk_src="$3"; idle_prompt="$4"; atk_prompt="$5"
  idle_sheet="public/sprites/anim_${key}_idle.png"
  atk_sheet="public/sprites/anim_${key}_attack.png"

  if [ -f "$idle_sheet" ] && [ -f "$atk_sheet" ]; then
    echo "== $key: already baked, skipping =="
    return
  fi
  echo "== $key: idle =="
  py tools/seedance.py --first "$idle_src" \
     --prompt "$idle_prompt, flat static solid background" \
     --out "tools/seed/${key}_idle.mp4" --duration 4 --res 480p --host uguu || { echo "$key idle FAILED"; return; }
  echo "== $key: attack =="
  py tools/seedance.py --first "$idle_src" --last "$atk_src" \
     --prompt "$atk_prompt, flat static solid background" \
     --out "tools/seed/${key}_atk.mp4" --duration 4 --res 480p --host uguu || { echo "$key atk FAILED"; return; }
  echo "== $key: bake =="
  py tools/vid2frames.py --in "tools/seed/${key}_idle.mp4" --frames 8 --height 200 --sheet "$idle_sheet"
  py tools/vid2frames.py --in "tools/seed/${key}_atk.mp4"  --frames 6 --height 200 --sheet "$atk_sheet"
  echo "== $key: DONE =="
}

# key         idle_src                              atk_src                                       idle_prompt                                          atk_prompt
gen tralalero  assets/raw/meme_tralalero.png        public/sprites/meme_tralalero_attack.png      "menacing shark idle, jaws flexing, slow sway"        "lunges forward jaws snapping in a vicious bite attack"
gen tungtung   assets/raw/meme_tungtung.png         public/sprites/meme_tungtung_attack.png       "wooden idle, slight wobble and breathing"            "swings its club forward in a heavy smash attack"
gen angler     assets/raw/enemy_angler.png          public/sprites/enemy_angler_attack.png        "anglerfish idle, lure bobbing, fins drifting"        "darts forward maw gaping in a biting attack"
gen ballerina  assets/raw/meme_ballerina.png        public/sprites/meme_ballerina_attack.png      "graceful idle, gentle balletic sway on pointe"       "spins into a whirling pirouette attack"
gen bombardiro assets/raw/meme_bombardiro.png       public/sprites/meme_bombardiro_attack.png     "hovering idle, propellers turning, slight bob"       "swoops forward dropping a bomb in a strafing run"
gen crab       assets/raw/enemy_crab.png            public/sprites/enemy_crab_attack.png          "crab idle, claws clicking, legs shifting"            "snaps both pincers forward in a crushing attack"
gen daemon     assets/raw/enemy_daemon.png          public/sprites/enemy_daemon_attack.png        "rogue daemon idle, dark aura pulsing, hovering"      "lashes forward with corrupt energy in an attack"
gen trainer    assets/raw/enemy_trainer.png         public/sprites/enemy_trainer_attack.png       "runaway process idle, data flickering, looming"      "surges forward unleashing a destructive attack"
gen crawler    assets/raw/enemy_crawler.png         public/sprites/enemy_crawler_attack.png       "web crawler idle, legs twitching, scuttling in place" "skitters forward striking with sharp legs"

echo "ALL DONE"
