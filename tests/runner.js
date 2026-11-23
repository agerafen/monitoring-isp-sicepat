/*
 * runner.js - Pelari tes mini tanpa dependensi (berjalan di browser).
 *
 * API: T.group(nama) T.test(nama, fn, {skipIf}) T.eq(a, b) T.ok(kondisi, pesan) T.throws(fn) T.noThrow(fn)
 *      T.sleep(ms) T.run(). Tes dijalankan berurutan (async diperbolehkan), error satu tes tidak
 *      menghentikan tes lain. Hasil: #summary (kelas pass/fail), #report (teks), dan objek T.result.
 * Mode otomatis: atribut data-* pada #summary berisi angka total/lulus/gagal/lewati untuk dibaca skrip
 * (mis. chrome --headless --dump-dom).
 */
(function () {
  const tests = [];
  let currentGroup = '';

  const T = {
    result: null,
    group(name) { currentGroup = name; },
    test(name, fn, opts) { tests.push({ group: currentGroup, name, fn, opts: opts || {} }); },
    eq(actual, expected, msg) {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'diharapkan ' + b + ' tetapi dapat ' + a);
    },
    ok(cond, msg) { if (!cond) throw new Error(msg || 'kondisi bernilai salah'); },
    throws(fn, msg) {
      let threw = false;
      try { fn(); } catch (e) { threw = true; }
      if (!threw) throw new Error(msg || 'seharusnya melempar error');
    },
    noThrow(fn, msg) {
      try { return fn(); } catch (e) { throw new Error((msg ? msg + ': ' : 'tidak boleh melempar error: ') + e.message); }
    },
    sleep(ms) { return new Promise((r) => setTimeout(r, ms)); },
    /** Catatan ukuran/waktu yang ikut dilaporkan (mis. durasi tes performa). */
    note(text) { if (T._cur) T._cur.notes.push(text); }
  };

  /** Jalankan semua tes terdaftar lalu tampilkan laporan. */
  T.run = async function () {
    const results = [];
    for (const t of tests) {
      const rec = { group: t.group, name: t.name, status: 'pass', ms: 0, notes: [], error: '' };
      T._cur = rec;
      // Penanda progres: tes yang sedang berjalan ditulis ke atribut data-current (berguna saat tes macet).
      const sumEl = document.getElementById('summary');
      if (sumEl) sumEl.setAttribute('data-current', (results.length + 1) + '/' + tests.length + ' ' + t.group + ' :: ' + t.name);
      const start = performance.now();
      try {
        if (t.opts.skipIf && t.opts.skipIf()) { rec.status = 'skip'; }
        else await t.fn();
      } catch (err) {
        rec.status = 'fail';
        rec.error = (err && err.message) || String(err);
      }
      rec.ms = Math.round(performance.now() - start);
      results.push(rec);
    }
    T._cur = null;
    const count = (s) => results.filter((r) => r.status === s).length;
    const summary = { total: results.length, passed: count('pass'), failed: count('fail'), skipped: count('skip') };
    T.result = { summary, results };

    let lastGroup = null;
    const lines = [];
    results.forEach((r) => {
      if (r.group !== lastGroup) { lines.push('\n## ' + r.group); lastGroup = r.group; }
      const icon = r.status === 'pass' ? 'LULUS ' : r.status === 'fail' ? 'GAGAL ' : 'LEWAT ';
      lines.push(icon + r.name + '  (' + r.ms + ' ms)');
      r.notes.forEach((n) => lines.push('        - ' + n));
      if (r.error) lines.push('        ! ' + r.error);
    });
    const el = document.getElementById('summary');
    el.textContent = 'Total ' + summary.total + ' | Lulus ' + summary.passed + ' | Gagal ' + summary.failed + ' | Dilewati ' + summary.skipped;
    el.className = summary.failed ? 'fail' : 'pass';
    el.setAttribute('data-total', summary.total);
    el.setAttribute('data-passed', summary.passed);
    el.setAttribute('data-failed', summary.failed);
    el.setAttribute('data-skipped', summary.skipped);
    el.setAttribute('data-done', '1');
    document.getElementById('report').textContent = lines.join('\n');
    if (window.console) console.log('[tes] ' + el.textContent);
    return T.result;
  };

  window.T = T;
})();
