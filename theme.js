// PCB Viewer: Anzeige System/Hell/Dunkel – läuft im <head> (kein Flackern), wie BEAK DB mini
(function () {
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  function setzen(t) {
    var h = document.documentElement;
    if (t === 'light' || t === 'dark') h.setAttribute('data-theme', t); else h.removeAttribute('data-theme');
    var dunkel = t === 'dark' || (t !== 'light' && mq.matches);
    h.classList.toggle('ist-dunkel', dunkel);
    var m = document.querySelector('meta[name="color-scheme"]'); if (m) m.content = t === 'light' ? 'light' : t === 'dark' ? 'dark' : 'light dark';
    var tc = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < tc.length; i++) { tc[i].removeAttribute('media'); tc[i].content = dunkel ? '#1C1C1E' : '#FFFFFF'; }
  }
  window.beakTheme = function (t) { if (t !== undefined) { try { localStorage.setItem('beak-pcbv-theme', t); } catch (e) {} setzen(t); }
    try { return localStorage.getItem('beak-pcbv-theme') || 'system'; } catch (e) { return 'system'; } };
  setzen(window.beakTheme());
  mq.addEventListener && mq.addEventListener('change', function () { setzen(window.beakTheme()); });
})();
