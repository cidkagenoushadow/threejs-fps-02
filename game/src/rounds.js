// The round: buy phase, live play, bomb plant and defuse, round end, match end. One place
// owns the score, the money, the timers and the bomb, and tells the HUD what changed.
import { WEAPONS } from './weapons.js';

const BUY_SECONDS = 10;
const ROUND_SECONDS = 100;
const BOMB_SECONDS = 30;
const PLANT_SECONDS = 3;
const DEFUSE_SECONDS = 5;
const END_SECONDS = 4;
const WIN_ROUNDS = 5;
const MAX_ROUNDS = 9;
const WIN_MONEY = 3000;
const LOSS_MONEY = 1900;
const KILL_MONEY = 300;
const AMMO_PRICE = 200;

export function createRounds(deps) {
  const { bots, player, arsenal, hud, audio, map } = deps;

  const state = {
    phase: 'buy',
    roundNumber: 1,
    scoreT: 0,
    scoreCT: 0,
    money: 800,
    timer: BUY_SECONDS,
    bomb: {
      carriedBy: 'player',
      planted: false,
      site: null,
      position: null,
      timer: BOMB_SECONDS,
      plantProgress: 0,
      defuseProgress: 0,
    },
  };

  function siteAt(position) {
    for (const site of map.sites) {
      if (position.x >= site.min.x && position.x <= site.max.x && position.z >= site.min.z && position.z <= site.max.z) return site;
    }
    return null;
  }

  function startRound() {
    state.phase = 'buy';
    state.timer = BUY_SECONDS;
    state.bomb.carriedBy = 'player';
    state.bomb.planted = false;
    state.bomb.site = null;
    state.bomb.position = null;
    state.bomb.timer = BOMB_SECONDS;
    state.bomb.plantProgress = 0;
    state.bomb.defuseProgress = 0;
    bots.assignRound();
    bots.resetPositions();
    deps.resetPlayer();
    arsenal.refillAmmo();
    hud.setScore(state.scoreT, state.scoreCT, state.roundNumber);
    hud.setMoney(state.money);
    hud.setBomb('carry');
    hud.showBuy(true, arsenal.state.owned);
    hud.showBanner('');
  }

  function startMatch() {
    state.scoreT = 0;
    state.scoreCT = 0;
    state.money = 800;
    state.roundNumber = 1;
    arsenal.resetForMatch();
    startRound();
  }

  function endRound(winner, reason) {
    if (state.phase === 'end' || state.phase === 'match') return;
    if (winner === 'T') state.scoreT += 1;
    else state.scoreCT += 1;
    const playerWon = winner === 'T';
    state.money += playerWon ? WIN_MONEY : LOSS_MONEY;
    state.phase = 'end';
    state.timer = END_SECONDS;
    hud.setScore(state.scoreT, state.scoreCT, state.roundNumber);
    hud.setMoney(state.money);
    hud.showBuy(false);
    hud.showBanner(playerWon ? `ROUND WON — ${reason}` : `ROUND LOST — ${reason}`);
    hud.setBomb('none');
    audio.round(playerWon);
    deps.onRoundEnd(winner, reason);
  }

  function endMatch() {
    state.phase = 'match';
    const won = state.scoreT > state.scoreCT;
    hud.showMatch(won, state.scoreT, state.scoreCT);
    audio.round(won);
  }

  function checkElimination() {
    const tAlive = bots.aliveCount('T') + (player.alive ? 1 : 0);
    const ctAlive = bots.aliveCount('CT');
    if (state.bomb.planted) {
      if (ctAlive === 0) endRound('T', 'site defended');
      else if (tAlive === 0) {
        // Attackers all down with the bomb ticking: the round rides on the defuse.
      }
    } else {
      if (tAlive === 0) endRound('CT', 'team eliminated');
      else if (ctAlive === 0) endRound('T', 'site cleared');
    }
  }

  function step(dt) {
    if (state.phase === 'buy') {
      state.timer -= dt;
      hud.setTimer(Math.max(0, Math.ceil(state.timer)), 'BUY');
      if (state.timer <= 0) {
        state.phase = 'live';
        state.timer = ROUND_SECONDS;
        hud.showBuy(false);
        hud.setTimer(ROUND_SECONDS, 'LIVE');
        audio.beep(false);
      }
      return;
    }
    if (state.phase === 'live') {
      state.timer -= dt;
      if (state.bomb.planted) {
        state.bomb.timer -= dt;
        hud.setTimer(Math.max(0, Math.ceil(state.bomb.timer)), 'BOMB');
        if (Math.ceil(state.bomb.timer) !== Math.ceil(state.bomb.timer + dt)) audio.beep(true);
        if (state.bomb.timer <= 0) {
          deps.onBombExploded(state.bomb.position);
          endRound('T', 'bomb detonated');
          return;
        }
      } else {
        hud.setTimer(Math.max(0, Math.ceil(state.timer)), 'LIVE');
        if (state.timer <= 0) {
          endRound('CT', 'time expired');
          return;
        }
      }
      checkElimination();
      return;
    }
    if (state.phase === 'end') {
      state.timer -= dt;
      hud.setTimer(Math.max(0, Math.ceil(state.timer)), 'END');
      if (state.timer <= 0) {
        if (state.scoreT >= WIN_ROUNDS || state.scoreCT >= WIN_ROUNDS || state.roundNumber >= MAX_ROUNDS) {
          endMatch();
        } else {
          state.roundNumber += 1;
          startRound();
        }
      }
    }
  }

  return {
    state,
    startMatch,
    startRound,
    step,
    siteAt,
    // The player holds E inside a site to plant. Returns 'planting' | 'planted' | 'idle'.
    playerPlant(dt, holding, inSite) {
      if (state.phase !== 'live' || state.bomb.planted || state.bomb.carriedBy !== 'player') return 'idle';
      if (holding && inSite) {
        state.bomb.plantProgress += dt;
        hud.setProgress(state.bomb.plantProgress / PLANT_SECONDS, 'Planting');
        if (state.bomb.plantProgress >= PLANT_SECONDS) {
          state.bomb.planted = true;
          state.bomb.site = inSite;
          state.bomb.position = { x: player.position.x, z: player.position.z };
          state.bomb.timer = BOMB_SECONDS;
          state.bomb.plantProgress = 0;
          hud.setProgress(0, '');
          hud.setBomb('planted');
          hud.killfeed('You planted the bomb');
          audio.plant();
          return 'planted';
        }
        return 'planting';
      }
      state.bomb.plantProgress = Math.max(0, state.bomb.plantProgress - dt * 2);
      hud.setProgress(0, '');
      return 'idle';
    },
    // The player holds E beside the planted bomb to defuse (only when the player is a
    // defender; in this game the player attacks, so this path is unused in live play but
    // kept for the round logic to stay complete).
    playerDefuse(dt, holding, nearBomb) {
      if (state.phase !== 'live' || !state.bomb.planted) return 'idle';
      if (holding && nearBomb) {
        state.bomb.defuseProgress += dt;
        hud.setProgress(state.bomb.defuseProgress / DEFUSE_SECONDS, 'Defusing');
        if (state.bomb.defuseProgress >= DEFUSE_SECONDS) {
          hud.setProgress(0, '');
          endRound('CT', 'bomb defused');
          return 'defused';
        }
        return 'defusing';
      }
      state.bomb.defuseProgress = Math.max(0, state.bomb.defuseProgress - dt * 2);
      hud.setProgress(0, '');
      return 'idle';
    },
    onBotPlanted(bot) {
      if (state.phase !== 'live' || state.bomb.planted) return;
      const site = siteAt(bot.position);
      state.bomb.planted = true;
      state.bomb.site = site;
      state.bomb.position = { x: bot.position.x, z: bot.position.z };
      state.bomb.timer = BOMB_SECONDS;
      hud.setBomb('planted');
      hud.killfeed(`${bot.name} planted the bomb`);
      audio.plant();
    },
    onBotDefused(bot) {
      if (state.phase !== 'live' || !state.bomb.planted) return;
      hud.killfeed(`${bot.name} defused the bomb`);
      endRound('CT', 'bomb defused');
    },
    onKill(victimTeam, killerIsPlayer) {
      if (killerIsPlayer) {
        state.money += KILL_MONEY;
        hud.setMoney(state.money);
      }
    },
    // The player died: hand the bomb to a living teammate, or drop it if none is left.
    transferCarrier() {
      if (state.bomb.carriedBy !== 'player' || state.bomb.planted) return;
      const carrier = bots.teamBots('T').find((bot) => bot.alive);
      if (carrier) {
        state.bomb.carriedBy = carrier;
        bots.makeCarrier(carrier);
        hud.setBomb('teammate');
        hud.killfeed(`${carrier.name} picked up the bomb`);
      } else {
        state.bomb.carriedBy = null;
        hud.setBomb('dropped');
      }
    },
    // A carrier bot died: hand the bomb to another living teammate, or drop it.
    transferCarrierFromBot(dead) {
      if (state.bomb.carriedBy !== dead || state.bomb.planted) return;
      const carrier = bots.teamBots('T').find((bot) => bot.alive && bot !== dead);
      if (carrier) {
        state.bomb.carriedBy = carrier;
        bots.makeCarrier(carrier);
        hud.setBomb('teammate');
        hud.killfeed(`${carrier.name} picked up the bomb`);
      } else {
        state.bomb.carriedBy = null;
        hud.setBomb('dropped');
      }
    },
    buy(kind) {
      if (state.phase !== 'buy') return false;
      if (kind === 'grenade') {
        if (state.money < 300) return false;
        state.money -= 300;
        arsenal.buyGrenade();
      } else if (kind === 'ammo') {
        if (state.money < AMMO_PRICE) return false;
        state.money -= AMMO_PRICE;
        arsenal.refillAmmo();
      } else {
        const def = WEAPONS[kind];
        if (!def || state.money < def.price || arsenal.state.owned[kind]) return false;
        state.money -= def.price;
        arsenal.buy(kind);
      }
      hud.setMoney(state.money);
      hud.refreshBuy(arsenal.state.owned);
      return true;
    },
    checkElimination,
  };
}
