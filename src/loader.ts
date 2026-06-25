// Asset preloading. The game lazily loads sprite PNGs on first use, which causes
// pop-in (and a long stall on the no-CDN host before a battle). We preload the
// relevant set behind a loading screen so each transition is smooth — and the
// screen lasts exactly as long as the load actually takes (measured, not guessed).

// AUTO-LISTED from public/sprites (see tools note). Preload targets.
export const ALL_SPRITES: string[] = [
  '/sprites/agent_base.png',
  '/sprites/agent_base_back.png',
  '/sprites/agent_base_right.png',
  '/sprites/agent_battle.png',
  '/sprites/ally_mermaid.png',
  '/sprites/anim_angler_attack.png',
  '/sprites/anim_angler_idle.png',
  '/sprites/anim_ballerina_attack.png',
  '/sprites/anim_ballerina_idle.png',
  '/sprites/anim_bombardiro_attack.png',
  '/sprites/anim_bombardiro_idle.png',
  '/sprites/anim_crab_attack.png',
  '/sprites/anim_crab_idle.png',
  '/sprites/anim_crawler_attack.png',
  '/sprites/anim_crawler_idle.png',
  '/sprites/anim_daemon_attack.png',
  '/sprites/anim_daemon_idle.png',
  '/sprites/anim_goblin_attack.png',
  '/sprites/anim_goblin_blaster.png',
  '/sprites/anim_goblin_hurt.png',
  '/sprites/anim_goblin_idle.png',
  '/sprites/anim_goblin_victory.png',
  '/sprites/anim_goblin_walk_down.png',
  '/sprites/anim_goblin_walk_left.png',
  '/sprites/anim_goblin_walk_right.png',
  '/sprites/anim_goblin_walk_up.png',
  '/sprites/anim_hallucination_attack.png',
  '/sprites/anim_hallucination_idle.png',
  '/sprites/anim_trainer_attack.png',
  '/sprites/anim_trainer_idle.png',
  '/sprites/anim_tralalero_attack.png',
  '/sprites/anim_tralalero_idle.png',
  '/sprites/anim_tungtung_attack.png',
  '/sprites/anim_tungtung_idle.png',
  '/sprites/battle/cortex_atk.png',
  '/sprites/battle/cortex_idle.png',
  '/sprites/battle/cortex_melee.png',
  '/sprites/battle/evilbot_atk.png',
  '/sprites/battle/evilbot_idle.png',
  '/sprites/battle/evilbot_melee.png',
  '/sprites/battle/humanoid_atk.png',
  '/sprites/battle/humanoid_idle.png',
  '/sprites/battle/humanoid_melee.png',
  '/sprites/battle/monkey_atk.png',
  '/sprites/battle/monkey_idle.png',
  '/sprites/battle/monkey_melee.png',
  '/sprites/cortex_back.png',
  '/sprites/cortex_base.png',
  '/sprites/cortex_battle.png',
  '/sprites/cortex_right.png',
  '/sprites/enemy_angler.png',
  '/sprites/enemy_angler_attack.png',
  '/sprites/enemy_angler_attack_chroma.png',
  '/sprites/enemy_crab.png',
  '/sprites/enemy_crab_attack.png',
  '/sprites/enemy_crab_attack_chroma.png',
  '/sprites/enemy_crawler.png',
  '/sprites/enemy_crawler_attack.png',
  '/sprites/enemy_crawler_attack_chroma.png',
  '/sprites/enemy_daemon.png',
  '/sprites/enemy_daemon_attack.png',
  '/sprites/enemy_daemon_attack_chroma.png',
  '/sprites/enemy_hallucination.png',
  '/sprites/enemy_hallucination_attack.png',
  '/sprites/enemy_hallucination_attack_chroma.png',
  '/sprites/enemy_shark.png',
  '/sprites/enemy_trainer.png',
  '/sprites/enemy_trainer_attack.png',
  '/sprites/enemy_trainer_attack_chroma.png',
  '/sprites/meme_ballerina.png',
  '/sprites/meme_ballerina_attack.png',
  '/sprites/meme_ballerina_attack_chroma.png',
  '/sprites/meme_bombardiro.png',
  '/sprites/meme_bombardiro_attack.png',
  '/sprites/meme_bombardiro_attack_chroma.png',
  '/sprites/meme_goblinmonkey.png',
  '/sprites/meme_goblinmonkey_attack.png',
  '/sprites/meme_goblinmonkey_attack_chroma.png',
  '/sprites/meme_goblinmonkey_blaster.png',
  '/sprites/meme_goblinmonkey_blaster_chroma.png',
  '/sprites/meme_tralalero.png',
  '/sprites/meme_tralalero_attack.png',
  '/sprites/meme_tralalero_attack_chroma.png',
  '/sprites/meme_tungtung.png',
  '/sprites/meme_tungtung_attack.png',
  '/sprites/meme_tungtung_attack_chroma.png',
  '/sprites/monkey_back.png',
  '/sprites/monkey_base.png',
  '/sprites/monkey_battle.png',
  '/sprites/monkey_right.png',
  '/sprites/player_diver.png',
  '/sprites/robot_back.png',
  '/sprites/robot_base.png',
  '/sprites/robot_battle.png',
  '/sprites/robot_right.png',
  '/sprites/walk/cortex_back.png',
  '/sprites/walk/cortex_front.png',
  '/sprites/walk/cortex_left.png',
  '/sprites/walk/cortex_right.png',
  '/sprites/walk/evilbot_back.png',
  '/sprites/walk/evilbot_front.png',
  '/sprites/walk/evilbot_left.png',
  '/sprites/walk/evilbot_right.png',
  '/sprites/walk/humanoid_back.png',
  '/sprites/walk/humanoid_front.png',
  '/sprites/walk/humanoid_left.png',
  '/sprites/walk/humanoid_right.png',
  '/sprites/walk/monkey_back.png',
  '/sprites/walk/monkey_front.png',
  '/sprites/walk/monkey_left.png',
  '/sprites/walk/monkey_right.png',
  '/sprites/world_alien_cliff.png',
  '/sprites/world_alien_ground.png',
  '/sprites/world_alien_sky.png',
  '/sprites/world_alienflora.png',
  '/sprites/world_coral.png',
  '/sprites/world_crystal.png',
  '/sprites/world_kelp.png',
  '/sprites/world_seabed.png',
  '/sprites/world_spire.png',
];

// Scoped sets so each transition only waits on what it needs.
export const OVERWORLD_ASSETS = ALL_SPRITES.filter(
  (u) => /world_|\/walk\/|ally_|player_|cortex_|monkey_|robot_|agent_/.test(u) && !/_battle/.test(u),
);
export const BATTLE_ASSETS = ALL_SPRITES.filter(
  (u) => /_battle|\/battle\/|anim_|enemy_|meme_/.test(u),
);

// Preload a list of image URLs, reporting progress 0..1. Resolves once every
// image has settled (load OR error — a missing file must never hang the screen).
// Returns the elapsed milliseconds so callers can log/measure real load time.
export function preloadImages(urls: string[], onProgress?: (done: number, total: number) => void): Promise<number> {
  const t0 = performance.now();
  const total = urls.length;
  if (!total) { onProgress?.(0, 0); return Promise.resolve(0); }
  let done = 0;
  return new Promise((resolve) => {
    const tick = () => { done++; onProgress?.(done, total); if (done >= total) resolve(performance.now() - t0); };
    for (const url of urls) {
      const img = new Image();
      img.onload = tick;
      img.onerror = tick;
      img.src = url;
    }
  });
}
