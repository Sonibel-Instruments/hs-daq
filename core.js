/* HS DAQ app: pure logic (no DOM, no storage). Loaded by index.html and by test.html.
   State shape:
   { v:1, visit:{name,operator},
     sessions:[{id,num,unit,created,clockReading,clockPhone,offsetMs,clockTz,notes,ended}],
     joints:[{id,name,plateIn,thickIn,leadTabIn,exitTabIn,stationA,faceA,mirrored,notes}],
     passes:[{id,sessionId,jointId,passNo,weldIds,side,direction,kind,mic,volts,amps,ipm,stickout,wire,
              intent,conditions:[],verdict,note,created}],
     events:[{id,passId,t,type,tag,note}],          t = phone epoch ms; type in EVENT_TYPES
     media:[{id,passId,jointId,inspId,kind,t0,t1,mime,size,exported}],   kind = photo | video
     insp:[{id,jointId,method,report,date,result,note,t}],
     device (random id of this phone), active:{passId} } */
(function (root) {
  'use strict';
  var EVENT_TYPES = ['ARC_START', 'PLATE_IN', 'PLATE_OUT', 'ARC_STOP', 'MARK'];
  var LABEL = { ARC_START: 'Pass started', PLATE_IN: 'Entered plate', PLATE_OUT: 'Left plate', ARC_STOP: 'Arc stopped', MARK: 'Mark' };

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function utc(ms) {
    if (ms == null || ms === '') return '';
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1, 2) + '-' + pad(d.getUTCDate(), 2) + ' ' +
      pad(d.getUTCHours(), 2) + ':' + pad(d.getUTCMinutes(), 2) + ':' + pad(d.getUTCSeconds(), 2) + '.' + pad(d.getUTCMilliseconds(), 3);
  }
  function secs(a, b) { return (a == null || b == null) ? '' : ((b - a) / 1000).toFixed(3); }
  function by(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function passEvents(state, passId) {
    return state.events.filter(function (e) { return e.passId === passId; }).sort(function (a, b) { return a.t - b.t; });
  }

  /* Times of one pass, derived from its events (nothing is stored twice). */
  function passTimes(state, passId) {
    var ev = passEvents(state, passId), r = { arcStart: null, plateIn: null, plateOut: null, arcStop: null, welding: false, starts: 0 };
    ev.forEach(function (e) {
      if (e.type === 'ARC_START') { if (r.arcStart == null) r.arcStart = e.t; r.welding = true; r.starts++; r.lastStart = e.t; }
      else if (e.type === 'ARC_STOP') { r.arcStop = e.t; r.welding = false; }
      else if (e.type === 'PLATE_IN') { if (r.plateIn == null) r.plateIn = e.t; }
      else if (e.type === 'PLATE_OUT') { r.plateOut = e.t; }
    });
    if (r.welding) r.arcStop = null;
    return r;
  }
  /* Which stopwatch tap comes next. */
  function nextStep(state, passId) {
    var t = passTimes(state, passId);
    if (!t.welding) return 'ARC_START';
    if (t.plateIn == null) return 'PLATE_IN';
    if (t.plateOut == null) return 'PLATE_OUT';
    return 'ARC_STOP';
  }
  function weldIdList(s) {
    return String(s || '').split(/[^0-9]+/).filter(Boolean).map(Number);
  }
  /* Defaults for the next pass: copy the previous pass, bump pass number and weld id. */
  function nextPassDefaults(state, sessionId) {
    var inSession = state.passes.filter(function (p) { return p.sessionId === sessionId; });
    var prev = inSession.length ? inSession[inSession.length - 1] : (state.passes.length ? state.passes[state.passes.length - 1] : null);
    var p = { jointId: '', side: 'front', direction: '', kind: 'weld', mic: '', volts: '', amps: '', ipm: '', stickout: '', wire: '',
      intent: '', conditions: [], verdict: '', note: '', weldIds: '1', passNo: 1 };
    if (prev) ['jointId', 'side', 'direction', 'kind', 'mic', 'volts', 'amps', 'ipm', 'stickout', 'wire'].forEach(function (k) { p[k] = prev[k]; });
    var maxId = 0;
    inSession.forEach(function (q) { weldIdList(q.weldIds).forEach(function (n) { if (n > maxId) maxId = n; }); });
    p.weldIds = String(maxId + 1);
    p.passNo = nextPassNo(state, p.jointId);
    return p;
  }
  /* Next pass number in a joint: one more than the highest so far (also when no joint is chosen yet). */
  function nextPassNo(state, jointId, excludeId) {
    var mx = 0;
    state.passes.forEach(function (q) {
      if (q.id !== excludeId && (q.jointId || '') === (jointId || '')) { var n = parseInt(q.passNo, 10) || 0; if (n > mx) mx = n; }
    });
    return mx + 1;
  }
  function sessionLabel(s) { return s ? pad(parseInt(s.num, 10) || 0, 8) : ''; }
  function safe(x) { return String(x == null ? '' : x).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  /* File name of a photo / video: built from stable ids, so it never changes between exports. */
  function mediaName(state, m) {
    var ext = m.kind === 'photo' ? 'jpg' : (/webm/.test(m.mime || '') ? 'webm' : 'mp4');
    var p = m.passId ? by(state.passes, m.passId) : null, j, s, base;
    if (p) {
      j = by(state.joints, p.jointId); s = by(state.sessions, p.sessionId);
      base = 'hs_s' + sessionLabel(s) + '_w' + (weldIdList(p.weldIds).join('-') || 'x') + '_' + (safe(j && j.name) || 'nojoint') + '_p' + p.passNo;
    } else {
      j = by(state.joints, m.jointId);
      base = 'hs_' + (safe(j && j.name) || 'nojoint') + (m.inspId ? '_report' : '_joint');
    }
    return base + '_' + m.kind + '_' + m.id.slice(-6) + '.' + ext;
  }
  function mediaOf(state, key, id, kind) {
    return state.media.filter(function (m) { return m[key] === id && (!kind || m.kind === kind); });
  }

  /* The video that shows a pass: the in-app recording (its start time is known) that overlaps the arc the most.
     A tap at phone time t is at (t - video.t0) seconds into that video: negative means it happened before the
     video started, more than the video's length means after it ended. */
  function passVideo(state, passId) {
    var t = passTimes(state, passId), a = t.arcStart, b = t.arcStop != null ? t.arcStop : Infinity, best = null, bo = -Infinity;
    mediaOf(state, 'passId', passId, 'video').forEach(function (m) {
      if (m.t0 == null) return;
      var o = a == null ? 0 : Math.min(b, m.t1 || m.t0) - Math.max(a, m.t0);
      if (o > bo) { bo = o; best = m; }
    });
    return best;
  }

  /* ---------- CSV ---------- */
  function cell(v) {
    v = v == null ? '' : String(v);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function csv(cols, rows) {
    return '﻿' + [cols.join(',')].concat(rows.map(function (r) {
      return cols.map(function (c) { return cell(r[c]); }).join(',');
    })).join('\r\n') + '\r\n';
  }
  function recTime(s, ms) {   /* unit's displayed clock (time of day) at phone time ms, from the clock check */
    if (!s || s.offsetMs == null || s.offsetMs === '' || ms == null) return '';
    var d = new Date(ms), tod = ((d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) * 1000 + d.getMilliseconds() + Number(s.offsetMs)) % 86400000;
    if (tod < 0) tod += 86400000;
    var h = Math.floor(tod / 3600000), mi = Math.floor(tod % 3600000 / 60000), se = Math.floor(tod % 60000 / 1000);
    return pad(h, 2) + ':' + pad(mi, 2) + ':' + pad(se, 2) + '.' + pad(tod % 1000, 3);
  }
  var PASS_COLS = ['visit', 'operator', 'phone', 'unit', 'session', 'session_folder', 'weld_ids', 'joint', 'pass_in_joint', 'side',
    'direction', 'kind', 'mic', 'volts', 'amps', 'travel_ipm', 'stickout_in', 'wire', 'intent', 'conditions', 'verdict',
    'arc_start_utc', 'plate_in_utc', 'plate_out_utc', 'arc_stop_utc', 'plate_in_s', 'plate_out_s', 'arc_dur_s', 'arc_starts',
    'unit_clock_at_arc_start', 'unit_clock_offset_s', 'marks', 'photos', 'videos', 'video_file', 'video_dur_s', 'video_arc_start_s',
    'video_plate_in_s', 'video_plate_out_s', 'video_arc_stop_s', 'note', 'pass_id'];
  function passRows(state) {
    return state.passes.map(function (p) {
      var s = by(state.sessions, p.sessionId) || {}, j = by(state.joints, p.jointId) || {}, t = passTimes(state, p.id), v = passVideo(state, p.id), v0 = v ? v.t0 : null;
      var marks = passEvents(state, p.id).filter(function (e) { return e.type === 'MARK'; }).map(function (e) {
        return (t.arcStart != null ? secs(t.arcStart, e.t) + 's ' : '') + (e.tag || 'mark') + (e.note ? ' (' + e.note + ')' : '');
      });
      return { visit: state.visit.name, operator: state.visit.operator, phone: state.device, unit: s.unit, session: s.num,
        session_folder: s.num !== '' && s.num != null ? 'session-' + sessionLabel(s) : '', weld_ids: weldIdList(p.weldIds).join(';'),
        joint: j.name, pass_in_joint: p.passNo, side: p.side, direction: p.direction, kind: p.kind, mic: p.mic, volts: p.volts,
        amps: p.amps, travel_ipm: p.ipm, stickout_in: p.stickout, wire: p.wire, intent: p.intent, conditions: (p.conditions || []).concat(p.conditionOther ? [p.conditionOther] : []).join(';'),
        verdict: p.verdict, arc_start_utc: utc(t.arcStart), plate_in_utc: utc(t.plateIn), plate_out_utc: utc(t.plateOut),
        arc_stop_utc: utc(t.arcStop), plate_in_s: secs(t.arcStart, t.plateIn), plate_out_s: secs(t.arcStart, t.plateOut),
        arc_dur_s: secs(t.arcStart, t.arcStop), arc_starts: t.starts, unit_clock_at_arc_start: recTime(s, t.arcStart),
        unit_clock_offset_s: s.offsetMs == null || s.offsetMs === '' ? '' : (s.offsetMs / 1000).toFixed(3), marks: marks.join('; '),
        photos: mediaOf(state, 'passId', p.id, 'photo').map(function (m) { return mediaName(state, m); }).join('; '),
        videos: mediaOf(state, 'passId', p.id, 'video').map(function (m) { return mediaName(state, m); }).join('; '),
        video_file: v ? mediaName(state, v) : '', video_dur_s: v ? secs(v.t0, v.t1) : '', video_arc_start_s: secs(v0, t.arcStart),
        video_plate_in_s: secs(v0, t.plateIn), video_plate_out_s: secs(v0, t.plateOut), video_arc_stop_s: secs(v0, t.arcStop),
        note: p.note, pass_id: p.id };
    });
  }
  var EVENT_COLS = ['session', 'weld_ids', 'joint', 'pass_in_joint', 'event_no', 'event', 'tag', 'phone_time_utc', 's_after_arc_start',
    'unit_clock', 'video_file', 'video_s', 'note', 'pass_id'];
  function eventRows(state) {
    var rows = [];
    state.passes.forEach(function (p) {
      var s = by(state.sessions, p.sessionId) || {}, j = by(state.joints, p.jointId) || {}, t = passTimes(state, p.id), v = passVideo(state, p.id);
      passEvents(state, p.id).forEach(function (e, i) {
        rows.push({ session: s.num, weld_ids: weldIdList(p.weldIds).join(';'), joint: j.name, pass_in_joint: p.passNo, event_no: i + 1,
          event: e.type, tag: e.tag, phone_time_utc: utc(e.t), s_after_arc_start: secs(t.arcStart, e.t), unit_clock: recTime(s, e.t),
          video_file: v ? mediaName(state, v) : '', video_s: v ? secs(v.t0, e.t) : '', note: e.note, pass_id: p.id });
      });
    });
    return rows;
  }
  var JOINT_COLS = ['joint', 'plate_in', 'thickness_in', 'lead_tab_in', 'exit_tab_in', 'station_a', 'face_a', 'backside_mirrored',
    'n_passes', 'sessions', 'photos', 'notes'];
  function jointRows(state) {
    return state.joints.map(function (j) {
      var ps = state.passes.filter(function (p) { return p.jointId === j.id; }), seen = {};
      ps.forEach(function (p) { var s = by(state.sessions, p.sessionId); if (s) seen[s.num] = 1; });
      return { joint: j.name, plate_in: j.plateIn, thickness_in: j.thickIn, lead_tab_in: j.leadTabIn, exit_tab_in: j.exitTabIn,
        station_a: j.stationA, face_a: j.faceA, backside_mirrored: j.mirrored, n_passes: ps.length, sessions: Object.keys(seen).join(';'),
        photos: state.media.filter(function (m) { return m.jointId === j.id && !m.inspId; }).map(function (m) { return mediaName(state, m); }).join('; '),
        notes: j.notes };
    });
  }
  var INSP_COLS = ['joint', 'method', 'report', 'report_date', 'result', 'note', 'photos', 'entered_utc'];
  function inspRows(state) {
    return state.insp.map(function (r) {
      var j = by(state.joints, r.jointId) || {};
      return { joint: j.name, method: r.method, report: r.report, report_date: r.date, result: r.result, note: r.note,
        photos: mediaOf(state, 'inspId', r.id).map(function (m) { return mediaName(state, m); }).join('; '), entered_utc: utc(r.t) };
    });
  }
  var MEDIA_COLS = ['file', 'kind', 'session', 'weld_ids', 'joint', 'pass_in_joint', 'start_utc', 'end_utc', 'dur_s',
    's_after_arc_start', 'size_bytes', 'mime', 'exported'];
  function mediaRows(state) {
    return state.media.map(function (m) {
      var p = m.passId ? by(state.passes, m.passId) : null, s = p ? by(state.sessions, p.sessionId) : null;
      var j = by(state.joints, p ? p.jointId : m.jointId) || {}, t = p ? passTimes(state, p.id) : {};
      return { file: mediaName(state, m), kind: m.kind, session: s ? s.num : '', weld_ids: p ? weldIdList(p.weldIds).join(';') : '',
        joint: j.name, pass_in_joint: p ? p.passNo : '', start_utc: utc(m.t0), end_utc: utc(m.t1), dur_s: secs(m.t0, m.t1),
        s_after_arc_start: secs(t.arcStart, m.t0), size_bytes: m.size, mime: m.mime, exported: m.exported ? 'yes' : 'no' };
    });
  }
  function exportFiles(state, stamp) {
    var pre = 'hs-daq-' + (safe(state.visit.name) || 'visit') + '-' + stamp + '-';
    return [
      { name: pre + 'passes.csv', text: csv(PASS_COLS, passRows(state)) },
      { name: pre + 'events.csv', text: csv(EVENT_COLS, eventRows(state)) },
      { name: pre + 'joints.csv', text: csv(JOINT_COLS, jointRows(state)) },
      { name: pre + 'inspection.csv', text: csv(INSP_COLS, inspRows(state)) },
      { name: pre + 'media.csv', text: csv(MEDIA_COLS, mediaRows(state)) },
      { name: pre + 'backup.json', text: JSON.stringify({ app: 'hsdaq', version: 1, exported: utc(Date.now()), state: state }) }
    ];
  }
  function bundleName(state, stamp, what) {
    return 'hsdaq_' + (safe(state.visit.name) || 'visit') + '_' + (safe(state.visit.operator) || 'operator') + '_' + what + '_' + stamp + '.zip';
  }
  /* ---------- zip (stored, no compression): one file to share instead of many ---------- */
  var CRC = (function () { var t = [], c, n, k; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  /* files: [{name, bytes: Uint8Array}] -> array of Uint8Array pieces (pass straight to new Blob / new File) */
  function zip(files, when) {
    var enc = new TextEncoder(), d = new Date(when || Date.now()), parts = [], central = [], off = 0, csize = 0;
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = f.bytes, crc = crc32(data), h = new DataView(new ArrayBuffer(30)), c = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(10, time, true); h.setUint16(12, date, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(12, time, true); c.setUint16(14, date, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      parts.push(new Uint8Array(h.buffer), name, data); central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length; csize += 46 + name.length;
    });
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return parts.concat(central, [new Uint8Array(e.buffer)]);
  }
  /* Restore: add what is missing, and replace a record only when the backup's copy is the same id (backup wins on request). */
  function mergeState(state, incoming, overwrite) {
    var added = 0, replaced = 0;
    ['sessions', 'joints', 'passes', 'events', 'media', 'insp'].forEach(function (k) {
      (incoming[k] || []).forEach(function (x) {
        var i = state[k].map(function (y) { return y.id; }).indexOf(x.id);
        if (i < 0) { state[k].push(x); added++; } else if (overwrite) { state[k][i] = x; replaced++; }
      });
    });
    if (!state.visit.name && incoming.visit) state.visit = incoming.visit;
    return { added: added, replaced: replaced };
  }
  function blank() {
    return { v: 1, visit: { name: '', operator: '' }, sessions: [], joints: [], passes: [], events: [], media: [], insp: [], active: {} };
  }

  root.HSCore = { EVENT_TYPES: EVENT_TYPES, LABEL: LABEL, uid: uid, pad: pad, utc: utc, secs: secs, by: by, passEvents: passEvents,
    passTimes: passTimes, nextStep: nextStep, weldIdList: weldIdList, nextPassDefaults: nextPassDefaults, sessionLabel: sessionLabel,
    mediaName: mediaName, mediaOf: mediaOf, csv: csv, recTime: recTime, passRows: passRows, eventRows: eventRows, jointRows: jointRows,
    inspRows: inspRows, mediaRows: mediaRows, exportFiles: exportFiles, mergeState: mergeState, blank: blank, PASS_COLS: PASS_COLS,
    nextPassNo: nextPassNo, passVideo: passVideo, bundleName: bundleName, zip: zip, crc32: crc32 };
})(typeof window !== 'undefined' ? window : globalThis);
