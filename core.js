/* HS DAQ app: pure logic (no DOM, no storage). Loaded by index.html and by test.html.
   State shape:
   { v:1, visit:{name,operator},
     sessions:[{id,num,unit,stick,created,clockReading,clockPhone,offsetMs,clockTz,notes,ended}],
     joints:[{id,name,plateIn,thickIn,leadTabIn,exitTabIn,stationA,faceA,mirrored,notes}],
     passes:[{id,sessionId,jointId,passNo,weldIds,side,direction,kind,mic,volts,amps,ipm,stickout,wire,
              intent,conditions:[],verdict,note,created}],
     events:[{id,passId,t,type,tag,note}],          t = phone epoch ms; type in EVENT_TYPES
     media:[{id,passId,jointId,inspId,kind,t0,t1,mime,size,exported}],   kind = photo | video
     insp:[{id,jointId,method,report,date,result,note,t}],
     active:{sessionId,passId} } */
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
    p.passNo = state.passes.filter(function (q) { return q.jointId && q.jointId === p.jointId && q.kind === 'weld'; }).length + 1;
    return p;
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
  var PASS_COLS = ['visit', 'operator', 'unit', 'usb_stick', 'session', 'session_folder', 'weld_ids', 'joint', 'pass_in_joint', 'side',
    'direction', 'kind', 'mic', 'volts', 'amps', 'travel_ipm', 'stickout_in', 'wire', 'intent', 'conditions', 'verdict',
    'arc_start_utc', 'plate_in_utc', 'plate_out_utc', 'arc_stop_utc', 'plate_in_s', 'plate_out_s', 'arc_dur_s', 'arc_starts',
    'unit_clock_at_arc_start', 'unit_clock_offset_s', 'marks', 'photos', 'videos', 'note', 'pass_id'];
  function passRows(state) {
    return state.passes.map(function (p) {
      var s = by(state.sessions, p.sessionId) || {}, j = by(state.joints, p.jointId) || {}, t = passTimes(state, p.id);
      var marks = passEvents(state, p.id).filter(function (e) { return e.type === 'MARK'; }).map(function (e) {
        return (t.arcStart != null ? secs(t.arcStart, e.t) + 's ' : '') + (e.tag || 'mark') + (e.note ? ' (' + e.note + ')' : '');
      });
      return { visit: state.visit.name, operator: state.visit.operator, unit: s.unit, usb_stick: s.stick, session: s.num,
        session_folder: s.num !== '' && s.num != null ? 'session-' + sessionLabel(s) : '', weld_ids: weldIdList(p.weldIds).join(';'),
        joint: j.name, pass_in_joint: p.passNo, side: p.side, direction: p.direction, kind: p.kind, mic: p.mic, volts: p.volts,
        amps: p.amps, travel_ipm: p.ipm, stickout_in: p.stickout, wire: p.wire, intent: p.intent, conditions: (p.conditions || []).join(';'),
        verdict: p.verdict, arc_start_utc: utc(t.arcStart), plate_in_utc: utc(t.plateIn), plate_out_utc: utc(t.plateOut),
        arc_stop_utc: utc(t.arcStop), plate_in_s: secs(t.arcStart, t.plateIn), plate_out_s: secs(t.arcStart, t.plateOut),
        arc_dur_s: secs(t.arcStart, t.arcStop), arc_starts: t.starts, unit_clock_at_arc_start: recTime(s, t.arcStart),
        unit_clock_offset_s: s.offsetMs == null || s.offsetMs === '' ? '' : (s.offsetMs / 1000).toFixed(3), marks: marks.join('; '),
        photos: mediaOf(state, 'passId', p.id, 'photo').map(function (m) { return mediaName(state, m); }).join('; '),
        videos: mediaOf(state, 'passId', p.id, 'video').map(function (m) { return mediaName(state, m); }).join('; '),
        note: p.note, pass_id: p.id };
    });
  }
  var EVENT_COLS = ['session', 'weld_ids', 'joint', 'pass_in_joint', 'event_no', 'event', 'tag', 'phone_time_utc', 's_after_arc_start',
    'unit_clock', 'note', 'pass_id'];
  function eventRows(state) {
    var rows = [];
    state.passes.forEach(function (p) {
      var s = by(state.sessions, p.sessionId) || {}, j = by(state.joints, p.jointId) || {}, t = passTimes(state, p.id);
      passEvents(state, p.id).forEach(function (e, i) {
        rows.push({ session: s.num, weld_ids: weldIdList(p.weldIds).join(';'), joint: j.name, pass_in_joint: p.passNo, event_no: i + 1,
          event: e.type, tag: e.tag, phone_time_utc: utc(e.t), s_after_arc_start: secs(t.arcStart, e.t), unit_clock: recTime(s, e.t),
          note: e.note, pass_id: p.id });
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
    inspRows: inspRows, mediaRows: mediaRows, exportFiles: exportFiles, mergeState: mergeState, blank: blank, PASS_COLS: PASS_COLS };
})(typeof window !== 'undefined' ? window : globalThis);
