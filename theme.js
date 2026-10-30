// PCB Viewer: Hell/Dunkel folgt immer dem System – läuft im <head> (kein Flackern)
(function () {
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  try { localStorage.removeItem('beak-pcbv-theme'); } catch (e) {}
  function setzen() {
    var h = document.documentElement, dunkel = mq.matches;
    h.classList.toggle('ist-dunkel', dunkel);
    var tc = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < tc.length; i++) { tc[i].removeAttribute('media'); tc[i].content = dunkel ? '#1C1C1E' : '#FFFFFF'; }
  }
  setzen();
  mq.addEventListener ? mq.addEventListener('change', setzen) : mq.addListener(setzen);
})();
