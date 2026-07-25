(() => {
  'use strict';
  const apply = () => {
    const game = window.__TAKKAR__;
    if (!game || !game.__polishInstalled) {
      requestAnimationFrame(apply);
      return;
    }
    if (game.qualityChoice === 'auto') game.detectQuality();
    game.resize();
  };
  requestAnimationFrame(apply);
})();
