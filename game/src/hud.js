// The DOM HUD: crosshair, hit marker, health, ammo, money, score, timer, alive counts, bomb
// status, kill feed, progress bar, buy menu and the overlay panels. It never touches the
// simulation; the game pushes numbers in and reads the play and buy callbacks out.
import { WEAPONS } from './weapons.js';

const COPY = {
  start: {
    title: 'Duskline',
    copy: 'A container yard at dusk. Plant the bomb at A or B, or clear the defenders. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'Duskline',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const healthFill = $('health-fill');
  const healthValue = $('health-value');
  const moneyValue = $('money-value');
  const scoreValue = $('score-value');
  const roundValue = $('round-value');
  const timerValue = $('timer-value');
  const timerLabel = $('timer-label');
  const aliveT = $('alive-t');
  const aliveCT = $('alive-ct');
  const bombStatus = $('bomb-status');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const progress = $('progress');
  const progressFill = $('progress-fill');
  const progressLabel = $('progress-label');
  const buyMenu = $('buy-menu');
  const hitmarker = $('hitmarker');
  const damageFlash = $('damage-flash');
  const ammoBox = $('ammo');

  let hitTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastWeapon = '';
  let lastHealth = -1;
  let lastMoney = -1;
  let lastScore = '';
  let lastTimer = '';
  let lastAlive = '';

  function pips(element, alive, total) {
    let text = '';
    for (let i = 0; i < total; i += 1) text += i < alive ? '●' : '○';
    element.textContent = text;
  }

  return {
    setAmmo(mag, reserve, weapon) {
      if (mag === lastMag && reserve === lastReserve && weapon === lastWeapon) return;
      lastMag = mag;
      lastReserve = reserve;
      lastWeapon = weapon;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = weapon;
      ammoBox.classList.toggle('empty', mag === 0);
    },
    setHealth(hp) {
      const value = Math.max(0, Math.ceil(hp));
      if (value === lastHealth) return;
      lastHealth = value;
      healthValue.textContent = String(value);
      healthFill.style.width = `${value}%`;
      healthFill.classList.toggle('low', value <= 30);
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyValue.textContent = `$${value}`;
    },
    setScore(t, ct, round) {
      const text = `${t} — ${ct}`;
      if (text === lastScore) return;
      lastScore = text;
      scoreValue.textContent = text;
      roundValue.textContent = `ROUND ${round}`;
    },
    setTimer(seconds, label) {
      const text = `${label} ${seconds}`;
      if (text === lastTimer) return;
      lastTimer = text;
      timerValue.textContent = String(seconds);
      timerLabel.textContent = label;
    },
    setAlive(tAlive, ctAlive) {
      const text = `${tAlive}|${ctAlive}`;
      if (text === lastAlive) return;
      lastAlive = text;
      pips(aliveT, tAlive, 5);
      pips(aliveCT, ctAlive, 5);
    },
    setBomb(status) {
      const texts = {
        carry: 'BOMB: YOU CARRY IT — plant at A or B (hold E)',
        planted: 'BOMB PLANTED — defend it',
        teammate: 'BOMB: teammate carries it',
        dropped: 'BOMB DROPPED — round rides on the clock',
        none: '',
      };
      bombStatus.textContent = texts[status] ?? '';
      bombStatus.classList.toggle('planted', status === 'planted');
    },
    setProgress(fraction, label) {
      if (fraction <= 0) {
        progress.hidden = true;
        return;
      }
      progress.hidden = false;
      progressFill.style.width = `${Math.min(100, fraction * 100)}%`;
      progressLabel.textContent = label;
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.25)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    damageFlash() {
      damageFlash.classList.add('on');
      setTimeout(() => damageFlash.classList.remove('on'), 180);
    },
    killfeed(text) {
      const item = document.createElement('div');
      item.textContent = text;
      killfeed.prepend(item);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => item.remove(), 6000);
    },
    showBanner(text) {
      banner.textContent = text;
      banner.hidden = !text;
    },
    showBuy(open, owned) {
      buyMenu.hidden = !open;
      if (open) this.refreshBuy(owned);
    },
    refreshBuy(owned) {
      for (const button of buyMenu.querySelectorAll('[data-buy]')) {
        const kind = button.dataset.buy;
        const isOwned = kind !== 'grenade' && kind !== 'ammo' && owned && owned[kind];
        button.classList.toggle('owned', Boolean(isOwned));
      }
    },
    showOverlay(mode, score) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    showMatch(won, t, ct) {
      title.textContent = won ? 'Duskline taken' : 'Yard held';
      copy.textContent = won
        ? `Your crew took the yard ${t} — ${ct}. Play again to run it back.`
        : `The defenders held the yard ${ct} — ${t}. Play again to run it back.`;
      play.textContent = 'Play again';
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    onBuy(handler) {
      buyMenu.addEventListener('click', (event) => {
        const button = event.target.closest('[data-buy]');
        if (button) handler(button.dataset.buy);
      });
    },
  };
}
