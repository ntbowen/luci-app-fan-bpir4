'use strict';
'require view';
'require fs';
'require uci';
'require ui';
'require poll';

/* ── Hardware paths ─────────────────────────────────────────────────────── */
var THERMAL_ZONE = '/sys/class/thermal/thermal_zone0';
var PWM_FAN      = '/sys/class/hwmon/hwmon1';
/* hwmon0 = cpu_thermal, hwmon2/3/4 = mt7996 WiFi radios */
var HWMON_CPU    = '/sys/class/hwmon/hwmon0/temp1_input';
var HWMON_WIFI   = [
	'/sys/class/hwmon/hwmon2/temp1_input',
	'/sys/class/hwmon/hwmon3/temp1_input',
	'/sys/class/hwmon/hwmon4/temp1_input'
];
/* UCI: section is anonymous @fan-bpir4[0], access via sections() */
var UCI_PKG = 'fan-bpir4';
var UCI_TYPE = 'fan-bpir4';

var COOLING_LEVELS = [0, 80, 128, 255];
var TRIP_MAP = {
	high: { sysfs: THERMAL_ZONE + '/trip_point_2_temp', label: 'active-high', state: 3 },
	med:  { sysfs: THERMAL_ZONE + '/trip_point_3_temp', label: 'active-med',  state: 2 },
	low:  { sysfs: THERMAL_ZONE + '/trip_point_4_temp', label: 'active-low',  state: 1 }
};

function showToast(msg, type, duration) {
	var colors = { info: '#1890ff', success: '#52c41a', warning: '#fa8c16', error: '#ff4d4f' };
	var color = colors[type] || colors.info;
	var el = document.createElement('div');
	el.style.cssText = [
		'position:fixed', 'top:20px', 'left:50%', 'transform:translateX(-50%)',
		'z-index:99999', 'background:#1f2937', 'color:#f9fafb',
		'padding:10px 22px', 'border-radius:8px', 'font-size:13px',
		'box-shadow:0 4px 16px rgba(0,0,0,.4)',
		'border-left:4px solid ' + color,
		'max-width:480px', 'word-break:break-word',
		'transition:opacity .3s', 'opacity:1', 'pointer-events:none'
	].join(';');
	el.textContent = msg;
	document.body.appendChild(el);
	setTimeout(function () {
		el.style.opacity = '0';
		setTimeout(function () { el.parentNode && el.parentNode.removeChild(el); }, 300);
	}, duration || 3000);
}

function pwmPercent(pwm) {
	return Math.round(pwm / 255 * 100);
}

function stateLabel(state) {
	return [_('Off'), _('Low'), _('Medium'), _('High')][state] || ('state' + state);
}
function stateColor(state) {
	return ['#aaa', '#52c41a', '#fa8c16', '#ff4d4f'][state] || '#aaa';
}
function tempColor(t) {
	if (t >= 80) return '#ff4d4f';
	if (t >= 60) return '#fa8c16';
	if (t >= 40) return '#fadb14';
	return '#52c41a';
}
function tempBar(pct, color) {
	return '<div style="height:4px;border-radius:2px;background:#f0f0f0;margin-top:6px;overflow:hidden">' +
		'<div style="height:100%;width:' + Math.min(pct, 100) + '%;background:' + color + ';transition:width .6s"></div></div>';
}
/* UCI helpers – anonymous section ---------------------------------------- */
function uciSid() {
	var secs = uci.sections(UCI_PKG, UCI_TYPE);
	return secs && secs.length ? secs[0]['.name'] : null;
}
function uciGet(opt, def) {
	var sid = uciSid();
	return sid ? (uci.get(UCI_PKG, sid, opt) || def) : def;
}
function uciSet(opt, val) {
	var sid = uciSid();
	if (sid) uci.set(UCI_PKG, sid, opt, val);
}
/* SVG fan blade ------------------------------------------------------------ */
function makeFanSVG() {
	/* PC case fan style: square frame + corner screws + real blade bezier paths + 3D gradients */
	var svg = [
		'<svg id="fan-svg" viewBox="0 0 120 120" width="120" height="120" xmlns="http://www.w3.org/2000/svg">',
		'<defs>',
		/* frame gradient - top-left light, bottom-right dark */
		'<linearGradient id="fg-frame" x1="0%" y1="0%" x2="100%" y2="100%">',
		'<stop offset="0%" stop-color="#6b7a8d"/>',
		'<stop offset="50%" stop-color="#4a5568"/>',
		'<stop offset="100%" stop-color="#2d3748"/>',
		'</linearGradient>',
		/* inner ring gradient */
		'<radialGradient id="fg-ring" cx="40%" cy="35%" r="60%">',
		'<stop offset="0%" stop-color="#2d3748"/>',
		'<stop offset="100%" stop-color="#1a202c"/>',
		'</radialGradient>',
		/* blade gradient - gives 3D swept look */
		'<linearGradient id="fg-blade" x1="0%" y1="0%" x2="100%" y2="100%">',
		'<stop offset="0%" stop-color="#718096"/>',
		'<stop offset="40%" stop-color="#a0aec0"/>',
		'<stop offset="100%" stop-color="#4a5568"/>',
		'</linearGradient>',
		/* blade highlight */
		'<linearGradient id="fg-blade-hi" x1="0%" y1="0%" x2="60%" y2="100%">',
		'<stop offset="0%" stop-color="#e2e8f0" stop-opacity="0.6"/>',
		'<stop offset="100%" stop-color="#e2e8f0" stop-opacity="0"/>',
		'</linearGradient>',
		/* hub gradient */
		'<radialGradient id="fg-hub" cx="35%" cy="30%" r="65%">',
		'<stop offset="0%" stop-color="#718096"/>',
		'<stop offset="60%" stop-color="#4a5568"/>',
		'<stop offset="100%" stop-color="#2d3748"/>',
		'</radialGradient>',
		/* hub center light */
		'<radialGradient id="fg-hub-c" cx="40%" cy="35%" r="55%">',
		'<stop offset="0%" stop-color="#e2e8f0"/>',
		'<stop offset="100%" stop-color="#a0aec0"/>',
		'</radialGradient>',
		/* screw gradient */
		'<radialGradient id="fg-screw" cx="35%" cy="30%" r="65%">',
		'<stop offset="0%" stop-color="#718096"/>',
		'<stop offset="100%" stop-color="#2d3748"/>',
		'</radialGradient>',
		/* drop shadow filter */
		'<filter id="fg-shadow" x="-10%" y="-10%" width="120%" height="120%">',
		'<feDropShadow dx="1" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.4"/>',
		'</filter>',
		'</defs>',

		/* ── outer frame: rounded square ── */
		'<rect x="2" y="2" width="116" height="116" rx="14" ry="14" fill="url(#fg-frame)" filter="url(#fg-shadow)"/>',
		/* frame bevel highlight (top-left edge) */
		'<rect x="2" y="2" width="116" height="116" rx="14" ry="14" fill="none" stroke="#8899aa" stroke-width="1.2" opacity="0.5"/>',
		/* inner shadow rim */
		'<rect x="6" y="6" width="108" height="108" rx="11" ry="11" fill="none" stroke="#1a202c" stroke-width="1.5" opacity="0.8"/>',

		/* ── four corner screws ── */
		/* top-left */ '<circle cx="14" cy="14" r="5" fill="url(#fg-screw)"/>',
		'<line x1="11.5" y1="14" x2="16.5" y2="14" stroke="#a0aec0" stroke-width="1" opacity="0.7"/>',
		'<line x1="14" y1="11.5" x2="14" y2="16.5" stroke="#a0aec0" stroke-width="1" opacity="0.7"/>',
		/* top-right */ '<circle cx="106" cy="14" r="5" fill="url(#fg-screw)"/>',
		'<line x1="103.5" y1="14" x2="108.5" y2="14" stroke="#a0aec0" stroke-width="1" opacity="0.7"/>',
		'<line x1="106" y1="11.5" x2="106" y2="16.5" stroke="#a0aec0" stroke-width="1" opacity="0.7"/>',
		/* bottom-left */ '<circle cx="14" cy="106" r="5" fill="url(#fg-screw)"/>',
		'<line x1="11.5" y1="106" x2="16.5" y2="106" stroke="#a0aec0" stroke-width="1" opacity="0.7"/>',
		'<line x1="14" y1="103.5" x2="14" y2="108.5" stroke="#a0aec0" stroke-width="1" opacity="0.7"/>',
		/* bottom-right */ '<circle cx="106" cy="106" r="5" fill="url(#fg-screw)"/>',
		'<line x1="103.5" y1="106" x2="108.5" y2="106" stroke="#a0aec0" stroke-width="1" opacity="0.7"/>',
		'<line x1="106" y1="103.5" x2="106" y2="108.5" stroke="#a0aec0" stroke-width="1" opacity="0.7"/>',

		/* ── circular fan housing ── */
		'<circle cx="60" cy="60" r="50" fill="url(#fg-ring)"/>',
		/* inner ring rim highlight */
		'<circle cx="60" cy="60" r="50" fill="none" stroke="#4a5568" stroke-width="1.5"/>',
		'<circle cx="60" cy="60" r="49" fill="none" stroke="#718096" stroke-width="0.5" opacity="0.4"/>',

		/* ── rotating blades group ── */
		/* Each blade: swept bezier shape rotated 90° apart, origin at center (60,60) */
		'<g id="fan-blades" style="transform-origin:60px 60px;animation:fan-spin 2s linear infinite;animation-play-state:paused">',

		/* Blade shape: starts near hub (60,60), sweeps outward with a twist.
		   Using cubic bezier to create the asymmetric airfoil shape.
		   One blade pointing UP, then rotated for the other 3. */

		/* Blade 1 – 0° */
		'<path d="M60,52 C56,45 44,30 48,18 C52,10 62,14 65,22 C68,30 64,42 60,52 Z"',
		' fill="url(#fg-blade)" opacity="0.92"/>',
		'<path d="M60,52 C56,45 44,30 48,18 C52,10 62,14 65,22 C68,30 64,42 60,52 Z"',
		' fill="url(#fg-blade-hi)" opacity="0.7"/>',

		/* Blade 2 – 90° */
		'<path d="M60,52 C56,45 44,30 48,18 C52,10 62,14 65,22 C68,30 64,42 60,52 Z"',
		' fill="url(#fg-blade)" opacity="0.92" transform="rotate(90 60 60)"/>',
		'<path d="M60,52 C56,45 44,30 48,18 C52,10 62,14 65,22 C68,30 64,42 60,52 Z"',
		' fill="url(#fg-blade-hi)" opacity="0.7" transform="rotate(90 60 60)"/>',

		/* Blade 3 – 180° */
		'<path d="M60,52 C56,45 44,30 48,18 C52,10 62,14 65,22 C68,30 64,42 60,52 Z"',
		' fill="url(#fg-blade)" opacity="0.92" transform="rotate(180 60 60)"/>',
		'<path d="M60,52 C56,45 44,30 48,18 C52,10 62,14 65,22 C68,30 64,42 60,52 Z"',
		' fill="url(#fg-blade-hi)" opacity="0.7" transform="rotate(180 60 60)"/>',

		/* Blade 4 – 270° */
		'<path d="M60,52 C56,45 44,30 48,18 C52,10 62,14 65,22 C68,30 64,42 60,52 Z"',
		' fill="url(#fg-blade)" opacity="0.92" transform="rotate(270 60 60)"/>',
		'<path d="M60,52 C56,45 44,30 48,18 C52,10 62,14 65,22 C68,30 64,42 60,52 Z"',
		' fill="url(#fg-blade-hi)" opacity="0.7" transform="rotate(270 60 60)"/>',

		'</g>',

		/* ── hub ── */
		'<circle cx="60" cy="60" r="11" fill="url(#fg-hub)"/>',
		'<circle cx="60" cy="60" r="11" fill="none" stroke="#2d3748" stroke-width="1.2"/>',
		/* hub center dot */
		'<circle cx="60" cy="60" r="5" fill="url(#fg-hub-c)"/>',
		/* hub specular */
		'<circle cx="57" cy="57" r="2.5" fill="#fff" opacity="0.35"/>',

		'</svg>'
	].join('');
	var wrap = document.createElement('div');
	wrap.innerHTML = svg;
	return wrap.firstChild;
}

return view.extend({

	load: function () {
		return Promise.all([
			uci.load(UCI_PKG),
			L.resolveDefault(fs.read(HWMON_CPU), '0'),
			L.resolveDefault(fs.read(HWMON_WIFI[0]), '0'),
			L.resolveDefault(fs.read(HWMON_WIFI[1]), '0'),
			L.resolveDefault(fs.read(HWMON_WIFI[2]), '0'),
			L.resolveDefault(fs.read(PWM_FAN + '/pwm1'), '0'),
			L.resolveDefault(fs.read(THERMAL_ZONE + '/policy'), 'step_wise'),
			L.resolveDefault(fs.read('/sys/class/thermal/cooling_device0/cur_state'), '0'),
			L.resolveDefault(fs.read(TRIP_MAP.high.sysfs), '115000'),
			L.resolveDefault(fs.read(TRIP_MAP.med.sysfs),  '85000'),
			L.resolveDefault(fs.read(TRIP_MAP.low.sysfs),  '40000'),
			L.resolveDefault(fs.read('/proc/stat'), ''),
			L.resolveDefault(fs.read('/proc/loadavg'), '0 0 0'),
			L.resolveDefault(fs.read('/proc/meminfo'), ''),
			L.resolveDefault(fs.read('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq'), '0'),
			L.resolveDefault(fs.read('/sys/devices/system/cpu/cpu1/cpufreq/scaling_cur_freq'), '0'),
			L.resolveDefault(fs.read('/sys/devices/system/cpu/cpu2/cpufreq/scaling_cur_freq'), '0'),
			L.resolveDefault(fs.read('/sys/devices/system/cpu/cpu3/cpufreq/scaling_cur_freq'), '0'),
			L.resolveDefault(fs.read('/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq'), '1800000')
		]);
	},

	render: function (data) {
		var cpuTemp  = Math.round(parseInt(data[1])  / 1000);
		var w24Temp  = Math.round(parseInt(data[2])  / 1000);
		var w5Temp   = Math.round(parseInt(data[3])  / 1000);
		var w6Temp   = Math.round(parseInt(data[4])  / 1000);
		var pwm      = parseInt(data[5])  || 0;
		var policy   = (data[6] || '').trim();
		var curState = parseInt(data[7])  || 0;
		var tripHigh = Math.round(parseInt(data[8])  / 1000);
		var tripMed  = Math.round(parseInt(data[9]) / 1000);
		var tripLow  = Math.round(parseInt(data[10]) / 1000);
		var procStat = data[11] || '';
		var loadAvg  = (data[12] || '0 0 0').trim().split(' ');
		var memInfo  = data[13] || '';
		var cpuFreqs = [parseInt(data[14])||0, parseInt(data[15])||0, parseInt(data[16])||0, parseInt(data[17])||0];
		var cpuMaxHz = parseInt(data[18]) || 1800000;

		/* Parse meminfo */
		var memTotal = 0, memAvail = 0;
		memInfo.split('\n').forEach(function(l) {
			var m = l.match(/^(\w+):\s+(\d+)/);
			if (!m) return;
			if (m[1] === 'MemTotal')     memTotal = parseInt(m[2]);
			if (m[1] === 'MemAvailable') memAvail = parseInt(m[2]);
		});
		var memUsed = memTotal - memAvail;
		var memPct  = memTotal ? Math.round(memUsed / memTotal * 100) : 0;

		/* Parse /proc/stat first line for initial CPU usage */
		var _prevStat = null;
		function parseStat(raw) {
			var m = raw.match(/^cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/);
			if (!m) return null;
			var vals = [1,2,3,4,5].map(function(i){ return parseInt(m[i]); });
			var total = vals.reduce(function(a,b){return a+b;}, 0);
			return { idle: vals[3], total: total };
		}
		_prevStat = parseStat(procStat);

		var uciMode     = uciGet('mode',       'auto');
		var uciPwm      = parseInt(uciGet('pwm',        '128'));
		var uciTempLow  = parseInt(uciGet('temp_low',   '40'));
		var uciTempMed  = parseInt(uciGet('temp_med',   '85'));
		var uciTempHigh = parseInt(uciGet('temp_high',  '115'));

		var isManual = (policy === 'user_space');

		// ── Styles ──────────────────────────────────────────────────────────
		var style = E('style', {}, [
			'@keyframes fan-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}',
			'#fan-blades{transform-origin:60px 60px;animation:fan-spin 2s linear infinite;animation-play-state:paused}',
			/* dashboard outer wrapper – same visual width as .fan-section */
			'.fan-dashboard-wrap{background:#fff;border:1px solid #e8e8e8;border-radius:12px;',
			'padding:20px 24px!important;box-shadow:0 2px 8px rgba(0,0,0,.06);margin-bottom:16px!important}',
			/* dashboard grid */
			'.fan-dashboard{display:grid;grid-template-columns:1fr 1.5fr 1fr;gap:0;margin:0}',
			'@media(max-width:860px){.fan-dashboard{grid-template-columns:1fr}}',
			/* cards inside dashboard: no outer shadow/border, use dividers instead */
			'.fan-card{padding:14px 20px!important}',
			'.fan-card+.fan-card{border-left:1px solid #f0f0f0}',
			'.fan-card-title{font-size:12px;font-weight:600;color:#888;text-transform:uppercase;',
			'letter-spacing:.05em;margin-bottom:14px}',
			'.fan-mem-bar{background:#fff;border:1px solid #e8e8e8;border-radius:12px;',
			'padding:20px 24px!important;box-shadow:0 2px 8px rgba(0,0,0,.06);margin-bottom:16px!important}',
			/* progress bars */
			'.fbar-wrap{height:6px;border-radius:3px;background:#f0f0f0;overflow:hidden;margin:4px 0}',
			'.fbar-fill{height:100%;border-radius:3px;transition:width .6s ease}',
			'.fbar-mini{height:4px;border-radius:2px;background:#f0f0f0;overflow:hidden;margin-top:4px}',
			'.fbar-mini .fbar-fill{height:100%}',
			/* ring */
			'.fan-ring-wrap{display:flex;flex-direction:column;align-items:center;gap:10px}',
			/* control section */
			'.fan-section{background:#fff;border:1px solid #e8e8e8;border-radius:12px;',
			'padding:20px 24px!important;margin-bottom:16px!important;box-shadow:0 2px 8px rgba(0,0,0,.06)}',
			'.fan-section h3{margin:0 0 14px 0;font-size:15px;font-weight:600;color:#333;',
			'border-bottom:1px solid #f0f0f0;padding-bottom:10px}',
			/* slider rows */
			'.fan-sl-row{display:grid;grid-template-columns:180px 1fr 80px 150px;',
			'align-items:center;gap:10px;margin-bottom:12px}',
			'.fan-sl-row label{font-size:13px;color:#555;font-weight:500}',
			'.fan-slider{width:100%;accent-color:#1890ff}',
			'.fan-sl-val{font-size:13px;font-weight:700;color:#1890ff;text-align:center}',
			'.fan-sl-hint{font-size:11px;color:#bbb}',
			/* mode buttons */
			'.fan-mode-btn{padding:8px 20px;border-radius:6px;border:1px solid #d9d9d9;',
			'background:#fff;font-size:13px;cursor:pointer;transition:all .2s;color:#555}',
			'.fan-mode-btn.active{background:#1890ff;border-color:#1890ff;color:#fff;font-weight:600}',
			'.fan-apply-btn{padding:9px 28px;border-radius:6px;border:none;',
			'background:#1890ff;color:#fff;font-size:14px;font-weight:600;cursor:pointer;',
			'transition:background .2s;margin-right:10px}',
			'.fan-apply-btn:hover{background:#40a9ff}',
			'.fan-reset-btn{padding:9px 22px;border-radius:6px;border:1px solid #d9d9d9;',
			'background:#fff;color:#555;font-size:14px;cursor:pointer;transition:all .2s}',
			'.fan-reset-btn:hover{border-color:#ff4d4f;color:#ff4d4f}',
			'.fan-badge{display:inline-block;padding:2px 10px;border-radius:10px;',
			'font-size:12px;font-weight:600;border:1px solid transparent}',
			'.fan-trip-table{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px}',
			'.fan-trip-table th{text-align:left;padding:6px 10px;color:#888;font-weight:500;',
			'border-bottom:1px solid #f0f0f0;background:#fafafa}',
			'.fan-trip-table td{padding:7px 10px;border-bottom:1px solid #f7f7f7}',
			'.fan-trip-table tr:last-child td{border-bottom:none}',
			'.fan-stat-row{display:flex;justify-content:space-between;align-items:center;',
			'margin-bottom:8px;font-size:13px}',
			'.fan-stat-label{color:#888}',
			'.fan-stat-val{font-weight:600;color:#333}'
		].join(''));

		/* ── Dashboard ────────────────────────────────────────────────── */
		/* Fan card */
		var fanSvgEl = makeFanSVG();
		var initPwmPct = pwmPercent(pwm);
		var ringR = 46, ringC = 2 * Math.PI * ringR;
		var ringOffset = ringC * (1 - initPwmPct / 100);
		var fanCard = E('div', { class: 'fan-card fan-ring-wrap' }, [
			E('div', { class: 'fan-card-title', style: 'align-self:flex-start' }, _('Fan')),
			/* SVG + ring overlay */
			E('div', { style: 'position:relative;width:120px;height:120px' }, [
				/* ring */
				E('svg', {
					viewBox: '0 0 100 100', width: '120', height: '120',
					style: 'position:absolute;top:0;left:0',
					xmlns: 'http://www.w3.org/2000/svg'
				}, [
					E('circle', {
						cx: '50', cy: '50', r: String(ringR),
						fill: 'none', stroke: '#f0f0f0', 'stroke-width': '5'
					}),
					E('circle', {
						id: 'fan-ring', cx: '50', cy: '50', r: String(ringR),
						fill: 'none', stroke: '#1890ff', 'stroke-width': '5',
						'stroke-dasharray': String(ringC),
						'stroke-dashoffset': String(ringOffset),
						'stroke-linecap': 'round',
						transform: 'rotate(-90 50 50)',
						style: 'transition:stroke-dashoffset .8s ease'
					})
				]),
				/* fan blades centered */
				E('div', { style: 'position:absolute;top:5px;left:5px' }, [ fanSvgEl ])
			]),
			/* PWM label */
			E('div', { style: 'text-align:center' }, [
				E('div', {
					id: 'fan-pwm-big',
					style: 'font-size:26px;font-weight:700;color:#1890ff;line-height:1'
				}, initPwmPct + '%'),
				E('div', { style: 'font-size:12px;color:#aaa;margin-top:2px' }, 'PWM ' + pwm)
			]),
			/* State badge */
			E('div', {
				id: 'fan-state-badge',
				style: 'display:inline-flex;align-items:center;gap:6px;' +
				       'background:#f6f8ff;border:1px solid #d6e4ff;border-radius:20px;' +
				       'padding:4px 14px;font-size:12px;font-weight:600'
			}, [
				E('span', {
					id: 'fan-state-dot',
					style: 'width:8px;height:8px;border-radius:50%;background:' + stateColor(curState)
				}),
				E('span', { id: 'fan-state-lbl' }, stateLabel(curState))
			]),
			/* Mode + governor */
			E('div', { style: 'font-size:12px;color:#bbb;text-align:center' }, [
				E('span', {
					id: 'fan-mode-badge',
					class: 'fan-badge',
					style: 'background:' + (isManual ? '#fff7e6' : '#f6ffed') +
					       ';border-color:' + (isManual ? '#ffd591' : '#b7eb8f') +
					       ';color:' + (isManual ? '#d46b08' : '#389e0d')
				}, isManual ? _('Manual') : _('Auto')),
				E('span', { id: 'fan-policy-text', style: 'margin-left:6px' }, policy)
			])
		]);

		/* CPU card */
		var load1 = parseFloat(loadAvg[0]) || 0;
		var load5 = parseFloat(loadAvg[1]) || 0;
		var load15= parseFloat(loadAvg[2]) || 0;
		var loadColor = load1 > 3 ? '#ff4d4f' : load1 > 1.5 ? '#fa8c16' : '#52c41a';
		var cpuMaxMhz = Math.round(cpuMaxHz / 1000);
		function makeCoreLine(coreId, freqHz, pct) {
			var mhz = Math.round(freqHz / 1000);
			var barColor = pct > 80 ? '#ff4d4f' : pct > 50 ? '#fa8c16' : '#1890ff';
			return E('div', { style: 'margin-bottom:7px' }, [
				E('div', { style: 'display:flex;justify-content:space-between;font-size:12px;color:#666;margin-bottom:2px' }, [
					E('span', {}, 'core' + coreId + '  ' + mhz + ' MHz'),
					E('span', { id: 'fan-core' + coreId + '-pct', style: 'color:#333;font-weight:600' }, pct + '%')
				]),
				E('div', { class: 'fbar-mini' }, [
					E('div', {
						id: 'fan-core' + coreId + '-bar',
						class: 'fbar-fill',
						style: 'width:' + pct + '%;background:' + barColor
					})
				])
			]);
		}
		var cpuCard = E('div', { class: 'fan-card' }, [
			E('div', { class: 'fan-card-title' }, _('CPU')),
			/* Overall usage */
			E('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px' }, [
				E('span', { style: 'font-size:12px;color:#888' }, _('Usage')),
				E('span', { id: 'fan-cpu-pct', style: 'font-size:22px;font-weight:700;color:#333' }, '—%')
			]),
			E('div', { class: 'fbar-wrap' }, [
				E('div', { id: 'fan-cpu-bar', class: 'fbar-fill', style: 'width:0%;background:#1890ff' })
			]),
			/* Load averages */
			E('div', { style: 'display:flex;gap:14px;margin:10px 0 12px;font-size:12px' }, [
				E('span', { style: 'color:#888' }, _('Load')),
				E('span', { style: 'font-weight:600;color:' + loadColor }, load1.toFixed(2)),
				E('span', { style: 'color:#aaa' }, load5.toFixed(2)),
				E('span', { style: 'color:#aaa' }, load15.toFixed(2)),
				E('span', { style: 'color:#ccc' }, '(1/5/15 min)')
			]),
			/* Divider */
			E('div', { style: 'border-top:1px solid #f0f0f0;margin-bottom:10px' }),
			/* Per-core */
			E('div', { id: 'fan-cores-wrap' }, [
				makeCoreLine(0, cpuFreqs[0], 0),
				makeCoreLine(1, cpuFreqs[1], 0),
				makeCoreLine(2, cpuFreqs[2], 0),
				makeCoreLine(3, cpuFreqs[3], 0)
			]),
			/* Max freq hint */
			E('div', { style: 'font-size:11px;color:#ccc;margin-top:4px' },
				_('Max: ') + cpuMaxMhz + ' MHz')
		]);

		/* Temperature card */
		function makeTempRow(id, label, tempVal) {
			var c = tempColor(tempVal);
			var pct = Math.max(0, Math.min(100, (tempVal - 20) / 80 * 100));
			return E('div', { style: 'margin-bottom:10px' }, [
				E('div', { style: 'display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px' }, [
					E('span', { style: 'color:#666' }, label),
					E('span', { id: id, style: 'font-weight:700;color:' + c }, tempVal + '°C')
				]),
				E('div', { class: 'fbar-mini' }, [
					E('div', {
						id: id + '-bar', class: 'fbar-fill',
						style: 'width:' + pct + '%;background:' + c
					})
				])
			]);
		}
		var tempCard = E('div', { class: 'fan-card' }, [
			E('div', { class: 'fan-card-title' }, _('Temperature')),
			makeTempRow('fan-temp-cpu', 'CPU / SoC',    cpuTemp),
			makeTempRow('fan-temp-24g', 'WiFi 2.4 GHz', w24Temp),
			makeTempRow('fan-temp-5g',  'WiFi 5 GHz',   w5Temp),
			makeTempRow('fan-temp-6g',  'WiFi 6 GHz',   w6Temp)
		]);

		var dashboard = E('div', { class: 'fan-dashboard-wrap' }, [
			E('div', { class: 'fan-dashboard' }, [ fanCard, cpuCard, tempCard ])
		]);

		/* Memory bar */
		var memColor = memPct > 80 ? '#ff4d4f' : memPct > 60 ? '#fa8c16' : '#1890ff';
		var memTotalMb = Math.round(memTotal / 1024);
		var memUsedMb  = Math.round(memUsed  / 1024);
		var memBar = E('div', { class: 'fan-mem-bar' }, [
			E('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px' }, [
				E('span', { style: 'font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.05em' }, _('Memory')),
				E('span', { id: 'fan-mem-label', style: 'font-size:13px;color:#555' },
					memUsedMb + ' / ' + memTotalMb + ' MB (' + memPct + '%)')
			]),
			E('div', { class: 'fbar-wrap' }, [
				E('div', { id: 'fan-mem-bar', class: 'fbar-fill',
					style: 'width:' + memPct + '%;background:' + memColor })
			])
		]);

		// ── Control: Mode toggle ────────────────────────────────────────
		var modeSection = E('div', { class: 'fan-section' }, [
			E('h3', {}, _('Control Mode')),
			E('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, [
				E('button', {
					id: 'fan-btn-auto',
					class: 'fan-mode-btn' + (uciMode !== 'manual' ? ' active' : ''),
					click: function () { window._fan_setModeUI('auto'); }
				}, _('Auto (Thermal Governor)')),
				E('button', {
					id: 'fan-btn-manual',
					class: 'fan-mode-btn' + (uciMode === 'manual' ? ' active' : ''),
					click: function () { window._fan_setModeUI('manual'); }
				}, _('Manual (Fixed PWM)')),
				E('span', { style: 'font-size:12px;color:#bbb' },
					_('Auto: kernel step_wise controls fan speed by temperature.') + ' ' +
					_('Manual: fixed PWM duty cycle, no temperature response.'))
			])
		]);

		// ── Control: Auto mode config ────────────────────────────────────
		function makeSliderRow(id, labelStr, val, min, max, stateN, pwmVal) {
			var pct = pwmPercent(pwmVal);
			return E('div', { class: 'fan-sl-row' }, [
				E('label', { 'for': id }, labelStr),
				E('input', {
					type: 'range', id: id, class: 'fan-slider',
					min: String(min), max: String(max), value: String(val),
					input: function () { window._fan_onSliderChange(); }
				}),
				E('span', { class: 'fan-sl-val', id: id + '-val' }, val + '°C'),
				E('span', { class: 'fan-sl-hint' },
					'→ state' + stateN + '  PWM ' + pwmVal + ' (' + pct + '%)')
			]);
		}

		var autoSection = E('div', {
			id: 'fan-auto-section',
			class: 'fan-section',
			style: uciMode === 'manual' ? 'display:none' : ''
		}, [
			E('h3', {}, _('Auto Mode — Trip Temperature Thresholds')),
			E('p', { style: 'font-size:12px;color:#888;margin:0 0 14px 0' },
				_('Fan speed increases as temperature rises. Hysteresis is 2°C (fan steps down 2°C below the threshold).')),
			makeSliderRow('fan-sl-low',  _('Low speed threshold (state 1)'),  uciTempLow,  10, 80,  1, COOLING_LEVELS[1]),
			makeSliderRow('fan-sl-med',  _('Medium speed threshold (state 2)'),uciTempMed,  20, 100, 2, COOLING_LEVELS[2]),
			makeSliderRow('fan-sl-high', _('Full speed threshold (state 3)'),  uciTempHigh, 30, 120, 3, COOLING_LEVELS[3]),
			E('div', { style: 'margin-top:8px' }, [
				E('table', { class: 'fan-trip-table' }, [
					E('thead', {}, E('tr', {}, [
						E('th', {}, _('State')),
						E('th', {}, _('Trigger')),
						E('th', {}, _('PWM')),
						E('th', {}, _('Duty'))
					])),
					E('tbody', {}, [
						E('tr', {}, [
							E('td', {}, _('0 — Off')),
							E('td', {}, '< ' + _('low threshold')),
							E('td', {}, '0'),
							E('td', {}, '0%')
						]),
						E('tr', {}, [
							E('td', {}, _('1 — Low')),
							E('td', { id: 'fan-tbl-low' }, '≥ ' + uciTempLow + '°C'),
							E('td', {}, String(COOLING_LEVELS[1])),
							E('td', {}, pwmPercent(COOLING_LEVELS[1]) + '%')
						]),
						E('tr', {}, [
							E('td', {}, _('2 — Medium')),
							E('td', { id: 'fan-tbl-med' }, '≥ ' + uciTempMed + '°C'),
							E('td', {}, String(COOLING_LEVELS[2])),
							E('td', {}, pwmPercent(COOLING_LEVELS[2]) + '%')
						]),
						E('tr', {}, [
							E('td', {}, _('3 — Full')),
							E('td', { id: 'fan-tbl-high' }, '≥ ' + uciTempHigh + '°C'),
							E('td', {}, String(COOLING_LEVELS[3])),
							E('td', {}, pwmPercent(COOLING_LEVELS[3]) + '%')
						])
					])
				])
			])
		]);

		// ── Section 3B: Manual mode config ───────────────────────────────
		// Fan start threshold: 66/255 (26%), stop threshold: 43/255 (17%)
		var FAN_START_PWM = 66;
		var FAN_STOP_PWM  = 43;
		var initPwmVal = uciPwm;
		function pwmWarningText(v) {
			if (v === 0) return _('Fan off (stopped)');
			if (v < FAN_START_PWM && v > FAN_STOP_PWM)
				return '⚠ ' + _('Dead zone') + ' (' + FAN_STOP_PWM + '–' + (FAN_START_PWM-1) + '/255): ' +
				       _('fan cannot start from rest, will keep spinning if already running');
			if (v <= FAN_STOP_PWM)
				return '⚠ ' + _('Below stop threshold') + ' (≤' + FAN_STOP_PWM + '/255): ' +
				       _('fan will stop even if currently spinning');
			return _('Min start') + ': ' + FAN_START_PWM + '/255 (26%)  ·  ' +
			       _('Stop below') + ': ' + FAN_STOP_PWM + '/255 (17%)';
		}
		var manualSection = E('div', {
			id: 'fan-manual-section',
			class: 'fan-section',
			style: uciMode === 'manual' ? '' : 'display:none'
		}, [
			E('h3', {}, _('Manual Mode — Fixed PWM Duty Cycle')),
			E('p', { style: 'font-size:12px;color:#888;margin:0 0 14px 0' },
				_('Fan runs at a fixed speed regardless of temperature. No thermal protection.')),
			/* quick preset buttons: Off / Min / Medium / Full */
			E('div', { style: 'display:flex;gap:8px;margin-bottom:14px' }, [
				E('button', {
					class: 'fan-reset-btn',
					click: function () { window._fan_setPwmUI(0); }
				}, _('Off (0)')),
				E('button', {
					class: 'fan-reset-btn',
					click: function () { window._fan_setPwmUI(FAN_START_PWM); }
				}, _('Min') + ' (' + FAN_START_PWM + ')'),
				E('button', {
					class: 'fan-reset-btn',
					click: function () { window._fan_setPwmUI(128); }
				}, '50% (128)'),
				E('button', {
					class: 'fan-reset-btn',
					click: function () { window._fan_setPwmUI(255); }
				}, _('Full (255)'))
			]),
			E('div', { class: 'fan-row' }, [
				E('label', { 'for': 'fan-sl-pwm' }, _('PWM duty cycle')),
				E('input', {
					type: 'range', id: 'fan-sl-pwm', class: 'fan-slider',
					min: '0', max: '255', value: String(initPwmVal),
					input: function () {
						var v = parseInt(this.value);
						var d = document.getElementById('fan-sl-pwm-val');
						var w = document.getElementById('fan-sl-pwm-warn');
						if (d) d.textContent = v + ' / 255 (' + pwmPercent(v) + '%)';
						if (w) {
							w.textContent = pwmWarningText(v);
							w.style.color = (v > 0 && v < FAN_START_PWM) ? '#fa8c16' : '#bbb';
						}
					}
				}),
				E('span', { class: 'fan-val', id: 'fan-sl-pwm-val' },
					initPwmVal + ' / 255 (' + pwmPercent(initPwmVal) + '%)')
			]),
			E('div', {
				id: 'fan-sl-pwm-warn',
				style: 'font-size:12px;margin-top:6px;padding-left:172px;color:' +
				       (initPwmVal > 0 && initPwmVal < FAN_START_PWM ? '#fa8c16' : '#bbb')
			}, pwmWarningText(initPwmVal))
		]);

		// ── Section 4: Apply / Reset ─────────────────────────────────────
		var applySection = E('div', { class: 'fan-section' }, [
			E('div', { style: 'display:flex;align-items:center;gap:0' }, [
				E('button', {
					class: 'fan-apply-btn',
					click: function () { window._fan_apply(); }
				}, _('Apply Settings')),
				E('button', {
					class: 'fan-reset-btn',
					click: function () { window._fan_resetDefaults(); }
				}, _('Restore Defaults')),
				E('span', {
					id: 'fan-apply-msg',
					style: 'margin-left:16px;font-size:13px;color:#999;min-height:18px'
				})
			])
		]);

		// ── Root node ────────────────────────────────────────────────────
		var node = E('div', { style: 'padding:0 16px' }, [
			style,
			E('h2', { style: 'margin-bottom:16px;font-size:18px;font-weight:700;color:#222' },
				_('Fan Control') + ' — BPI R4'),
			dashboard,
			memBar,
			modeSection,
			autoSection,
			manualSection,
			applySection
		]);

		// ── JS logic ─────────────────────────────────────────────────────
		var _currentMode = uciMode;

		window._fan_setPwmUI = function (v) {
			var sl = document.getElementById('fan-sl-pwm');
			var d  = document.getElementById('fan-sl-pwm-val');
			var w  = document.getElementById('fan-sl-pwm-warn');
			if (sl) sl.value = v;
			if (d)  d.textContent = v + ' / 255 (' + pwmPercent(v) + '%)';
			if (w) {
				w.textContent = pwmWarningText(v);
				w.style.color = (v > 0 && v < FAN_START_PWM) ? '#fa8c16' : '#bbb';
			}
		};

		window._fan_setModeUI = function (mode) {
			_currentMode = mode;
			var btnAuto   = document.getElementById('fan-btn-auto');
			var btnManual = document.getElementById('fan-btn-manual');
			var secAuto   = document.getElementById('fan-auto-section');
			var secManual = document.getElementById('fan-manual-section');
			if (btnAuto)   btnAuto.className   = 'fan-mode-btn' + (mode === 'auto'   ? ' active' : '');
			if (btnManual) btnManual.className  = 'fan-mode-btn' + (mode === 'manual' ? ' active' : '');
			if (secAuto)   secAuto.style.display   = mode === 'auto'   ? '' : 'none';
			if (secManual) secManual.style.display  = mode === 'manual' ? '' : 'none';
		};

		window._fan_onSliderChange = function () {
			var slLow  = document.getElementById('fan-sl-low');
			var slMed  = document.getElementById('fan-sl-med');
			var slHigh = document.getElementById('fan-sl-high');
			if (!slLow || !slMed || !slHigh) return;

			var low  = parseInt(slLow.value);
			var med  = parseInt(slMed.value);
			var high = parseInt(slHigh.value);

			// Enforce ordering: low < med < high
			if (low >= med)  { med  = low  + 5; slMed.value  = med;  }
			if (med >= high) { high = med  + 5; slHigh.value = high; }
			// Clamp to max
			if (high > 120) { high = 120; slHigh.value = 120; if (med >= high) { med = high - 5; slMed.value = med; } }
			if (med  > 115) { med  = 115; slMed.value  = 115; if (low >= med)  { low = med  - 5; slLow.value  = low; } }

			var dLow  = document.getElementById('fan-sl-low-val');
			var dMed  = document.getElementById('fan-sl-med-val');
			var dHigh = document.getElementById('fan-sl-high-val');
			if (dLow)  dLow.textContent  = low  + '°C';
			if (dMed)  dMed.textContent  = med  + '°C';
			if (dHigh) dHigh.textContent = high + '°C';

			var tLow  = document.getElementById('fan-tbl-low');
			var tMed  = document.getElementById('fan-tbl-med');
			var tHigh = document.getElementById('fan-tbl-high');
			if (tLow)  tLow.textContent  = '≥ ' + low  + '°C';
			if (tMed)  tMed.textContent  = '≥ ' + med  + '°C';
			if (tHigh) tHigh.textContent = '≥ ' + high + '°C';
		};

		function doUciSave() {
			/* Save UCI via shell to avoid uci.apply() RPC conflict with anonymous sections */
			var sid = uciSid();
			if (!sid) return Promise.reject(new Error('UCI section not found'));
			var chg = uci.state_ && uci.state_.changes && uci.state_.changes[UCI_PKG];
			if (!chg || !chg[sid]) return Promise.resolve();
			var cmds = [];
			var esc = function(s) { return "'" + String(s).replace(/'/g, "'\\''")+"'"; };
			Object.keys(chg[sid]).forEach(function(opt) {
				if (opt.charAt(0) === '.') return;
				cmds.push('uci set ' + UCI_PKG + '.@' + UCI_TYPE + '[0].' + opt + '=' + esc(chg[sid][opt]));
			});
			cmds.push('uci commit ' + UCI_PKG);
			return fs.exec('/bin/sh', ['-c', cmds.join('; ')]);
		}

		window._fan_apply = function () {
			var msg = document.getElementById('fan-apply-msg');
			if (msg) { msg.textContent = _('Applying...'); msg.style.color = '#1890ff'; }

			var mode = _currentMode;
			var sysfsPromises = [];

			if (mode === 'manual') {
				var slPwm = document.getElementById('fan-sl-pwm');
				var pwmVal = slPwm ? parseInt(slPwm.value) : uciPwm;
				sysfsPromises = [
					fs.write(THERMAL_ZONE + '/policy', 'user_space\n'),
					fs.write(PWM_FAN + '/pwm1_enable', '1\n'),
					fs.write(PWM_FAN + '/pwm1', pwmVal + '\n')
				];
				uciSet('mode', 'manual');
				uciSet('pwm', String(pwmVal));
			} else {
				var slLow  = document.getElementById('fan-sl-low');
				var slMed  = document.getElementById('fan-sl-med');
				var slHigh = document.getElementById('fan-sl-high');
				var tLow  = slLow  ? parseInt(slLow.value)  : uciTempLow;
				var tMed  = slMed  ? parseInt(slMed.value)  : uciTempMed;
				var tHigh = slHigh ? parseInt(slHigh.value) : uciTempHigh;
				uciSet('mode', 'auto');
				uciSet('temp_low',  String(tLow));
				uciSet('temp_med',  String(tMed));
				uciSet('temp_high', String(tHigh));
				/* Sequential: write trip temps, read current temp to compute
				   correct initial PWM, pre-set it in user_space, then hand
				   off to step_wise. thermal_zone0 has polling_delay=0
				   (interrupt-driven) so step_wise won't re-evaluate on
				   governor switch — we must prime the correct PWM ourselves. */
				sysfsPromises = [
					fs.write(TRIP_MAP.high.sysfs, (tHigh * 1000) + '\n')
						.then(function () { return fs.write(TRIP_MAP.med.sysfs,  (tMed  * 1000) + '\n'); })
						.then(function () { return fs.write(TRIP_MAP.low.sysfs,  (tLow  * 1000) + '\n'); })
						.then(function () { return fs.read(THERMAL_ZONE + '/temp'); })
						.then(function (tempRaw) {
							var curTemp = parseInt(tempRaw) || 0;
							var initPwm;
							if      (curTemp >= tHigh * 1000) initPwm = 255;
							else if (curTemp >= tMed  * 1000) initPwm = 128;
							else if (curTemp >= tLow  * 1000) initPwm = 80;
							else                              initPwm = 0;
							return fs.write(THERMAL_ZONE + '/policy', 'user_space\n')
								.then(function () { return fs.write(PWM_FAN + '/pwm1_enable', '1\n'); })
								.then(function () { return fs.write(PWM_FAN + '/pwm1', initPwm + '\n'); })
								.then(function () { return fs.write(THERMAL_ZONE + '/policy', 'step_wise\n'); });
						})
				];
			}

			Promise.all(sysfsPromises).then(function () {
				return doUciSave();
			}).then(function () {
				if (msg) { msg.textContent = _('Applied successfully.'); msg.style.color = '#52c41a'; }
				showToast(_('Fan settings applied.'), 'success');
				setTimeout(function () {
					if (msg && msg.textContent === _('Applied successfully.'))
						msg.textContent = '';
				}, 4000);
			}).catch(function (err) {
				if (msg) { msg.textContent = _('Error: ') + String(err); msg.style.color = '#ff4d4f'; }
				showToast(_('Failed to apply: ') + String(err), 'error');
			});
		};

		window._fan_resetDefaults = function () {
			ui.showModal(_('Restore Defaults'), [
				E('p', {}, _('Reset all fan settings to factory defaults?')),
				E('p', { style: 'font-size:13px;color:#888' },
					_('Auto mode · Low: 40°C · Med: 85°C · High: 115°C')),
				E('div', { class: 'right' }, [
					E('button', { class: 'btn', click: function () { ui.hideModal(); } }, _('Cancel')),
					E('button', {
						class: 'btn cbi-button-action',
						style: 'margin-left:8px',
						click: function () {
							ui.hideModal();
							var msg = document.getElementById('fan-apply-msg');

							Promise.all([
								fs.write(THERMAL_ZONE + '/policy', 'step_wise\n'),
								fs.write(TRIP_MAP.high.sysfs, '115000\n'),
								fs.write(TRIP_MAP.med.sysfs,  '85000\n'),
								fs.write(TRIP_MAP.low.sysfs,  '40000\n'),
								fs.write(PWM_FAN + '/pwm1_enable', '1\n')
							]).then(function () {
								uciSet('mode', 'auto');
								uciSet('temp_low',  '40');
								uciSet('temp_med',  '85');
								uciSet('temp_high', '115');
								return doUciSave();
							}).then(function () {
								if (msg) { msg.textContent = _('Defaults restored.'); msg.style.color = '#52c41a'; }
								showToast(_('Fan settings reset to defaults.'), 'success');
								// Update sliders
								['fan-sl-low', 'fan-sl-med', 'fan-sl-high'].forEach(function (id, i) {
									var defs = [40, 85, 115];
									var el = document.getElementById(id);
									if (el) { el.value = defs[i]; }
								});
								window._fan_setModeUI('auto');
								window._fan_onSliderChange();
							}).catch(function (err) {
								if (msg) { msg.textContent = _('Error: ') + String(err); msg.style.color = '#ff4d4f'; }
							});
						}
					}, _('Restore'))
				])
			]);
		};

		// ── Fan animation helper ─────────────────────────────────────────
		function updateFanAnimation(pwmVal) {
			var blades = document.getElementById('fan-blades');
			if (!blades) return;
			if (pwmVal === 0) {
				blades.style.animationPlayState = 'paused';
			} else {
				var dur = 0.4 + (1 - pwmVal / 255) * 3.6;
				blades.style.animationDuration  = dur.toFixed(2) + 's';
				blades.style.animationPlayState = 'running';
			}
			var ringEl = document.getElementById('fan-ring');
			if (ringEl) {
				var pct = pwmPercent(pwmVal);
				var offset = ringC * (1 - pct / 100);
				ringEl.style.strokeDashoffset = offset;
				ringEl.setAttribute('stroke', pct === 0 ? '#f0f0f0' : '#1890ff');
			}
			var big = document.getElementById('fan-pwm-big');
			if (big) big.textContent = pwmPercent(pwmVal) + '%';
			var pwmLbl = big && big.nextSibling;
			if (pwmLbl) pwmLbl.textContent = 'PWM ' + pwmVal;
		}

		// ── Polling ───────────────────────────────────────────────────────
		function updateStatus() {
			return Promise.all([
				L.resolveDefault(fs.read(HWMON_CPU), '0'),
				L.resolveDefault(fs.read(HWMON_WIFI[0]), '0'),
				L.resolveDefault(fs.read(HWMON_WIFI[1]), '0'),
				L.resolveDefault(fs.read(HWMON_WIFI[2]), '0'),
				L.resolveDefault(fs.read(PWM_FAN + '/pwm1'), '0'),
				L.resolveDefault(fs.read(THERMAL_ZONE + '/policy'), 'step_wise'),
				L.resolveDefault(fs.read('/sys/class/thermal/cooling_device0/cur_state'), '0'),
				L.resolveDefault(fs.read('/proc/stat'), ''),
				L.resolveDefault(fs.read('/proc/loadavg'), '0 0 0'),
				L.resolveDefault(fs.read('/proc/meminfo'), ''),
				L.resolveDefault(fs.read('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq'), '0'),
				L.resolveDefault(fs.read('/sys/devices/system/cpu/cpu1/cpufreq/scaling_cur_freq'), '0'),
				L.resolveDefault(fs.read('/sys/devices/system/cpu/cpu2/cpufreq/scaling_cur_freq'), '0'),
				L.resolveDefault(fs.read('/sys/devices/system/cpu/cpu3/cpufreq/scaling_cur_freq'), '0')
			]).then(function (d) {
				/* Temperatures */
				var tCpu = Math.round(parseInt(d[0]) / 1000);
				var tWifi= [Math.round(parseInt(d[1])/1000), Math.round(parseInt(d[2])/1000), Math.round(parseInt(d[3])/1000)];
				var tempData = [
					{ id: 'fan-temp-cpu', val: tCpu },
					{ id: 'fan-temp-24g', val: tWifi[0] },
					{ id: 'fan-temp-5g',  val: tWifi[1] },
					{ id: 'fan-temp-6g',  val: tWifi[2] }
				];
				tempData.forEach(function(td) {
					var el  = document.getElementById(td.id);
					var bar = document.getElementById(td.id + '-bar');
					var c   = tempColor(td.val);
					var pct = Math.max(0, Math.min(100, (td.val - 20) / 80 * 100));
					if (el)  { el.textContent = td.val + '°C'; el.style.color = c; }
					if (bar) { bar.style.width = pct + '%'; bar.style.background = c; }
				});

				/* Fan */
				var curPwm = parseInt(d[4]) || 0;
				var curPol = (d[5] || '').trim();
				var curSt  = parseInt(d[6]) || 0;
				var manual = curPol === 'user_space';
				updateFanAnimation(curPwm);
				var dot  = document.getElementById('fan-state-dot');
				var lbl  = document.getElementById('fan-state-lbl');
				if (dot) dot.style.background = stateColor(curSt);
				if (lbl) lbl.textContent = stateLabel(curSt);
				var badge = document.getElementById('fan-mode-badge');
				if (badge) {
					badge.textContent = manual ? _('Manual') : _('Auto');
					badge.style.background  = manual ? '#fff7e6' : '#f6ffed';
					badge.style.borderColor = manual ? '#ffd591' : '#b7eb8f';
					badge.style.color       = manual ? '#d46b08' : '#389e0d';
				}
				var pt = document.getElementById('fan-policy-text');
				if (pt) pt.textContent = curPol;

				/* CPU usage diff */
				var statRaw = d[7] || '';
				var cur = (function() {
					var m = statRaw.match(/^cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/);
					if (!m) return null;
					var v = [1,2,3,4,5].map(function(i){ return parseInt(m[i]); });
					return { idle: v[3], total: v.reduce(function(a,b){return a+b;},0) };
				})();
				if (cur && _prevStat) {
					var dt = cur.total - _prevStat.total;
					var di = cur.idle  - _prevStat.idle;
					var cpuPct = dt > 0 ? Math.round((dt - di) / dt * 100) : 0;
					var cpuBarEl  = document.getElementById('fan-cpu-bar');
					var cpuPctEl  = document.getElementById('fan-cpu-pct');
					var barColor  = cpuPct > 80 ? '#ff4d4f' : cpuPct > 50 ? '#fa8c16' : '#1890ff';
					if (cpuBarEl) { cpuBarEl.style.width = cpuPct + '%'; cpuBarEl.style.background = barColor; }
					if (cpuPctEl) { cpuPctEl.textContent = cpuPct + '%'; cpuPctEl.style.color = barColor; }
				}
				if (cur) _prevStat = cur;

				/* Per-core frequency */
				var coreFreqs = [parseInt(d[10])||0, parseInt(d[11])||0, parseInt(d[12])||0, parseInt(d[13])||0];
				coreFreqs.forEach(function(hz, i) {
					var mhz = Math.round(hz / 1000);
					var pct = cpuMaxHz ? Math.round(hz / cpuMaxHz * 100) : 0;
					var barEl = document.getElementById('fan-core' + i + '-bar');
					var lblEl = document.getElementById('fan-core' + i + '-pct');
					var c2 = pct > 90 ? '#fa8c16' : '#1890ff';
					var coreWrap = barEl && barEl.closest('.fan-card') && barEl.closest('.fan-card').querySelector('#fan-core' + i + '-bar');
					/* update label in parent div */
					if (barEl) {
						var rowEl = barEl.parentNode && barEl.parentNode.parentNode;
						if (rowEl) {
							var nameEl = rowEl.querySelector('span:first-child');
							if (nameEl) nameEl.textContent = 'core' + i + '  ' + mhz + ' MHz';
						}
						barEl.style.width = pct + '%';
						barEl.style.background = c2;
					}
					if (lblEl) { lblEl.textContent = pct + '%'; }
				});

				/* Memory */
				var mInfo = d[9] || '';
				var mTotal = 0, mAvail = 0;
				mInfo.split('\n').forEach(function(l) {
					var m = l.match(/^(\w+):\s+(\d+)/);
					if (!m) return;
					if (m[1] === 'MemTotal')     mTotal = parseInt(m[2]);
					if (m[1] === 'MemAvailable') mAvail = parseInt(m[2]);
				});
				var mUsed = mTotal - mAvail;
				var mPct  = mTotal ? Math.round(mUsed / mTotal * 100) : 0;
				var mColor = mPct > 80 ? '#ff4d4f' : mPct > 60 ? '#fa8c16' : '#1890ff';
				var mBarEl  = document.getElementById('fan-mem-bar');
				var mLblEl  = document.getElementById('fan-mem-label');
				if (mBarEl) { mBarEl.style.width = mPct + '%'; mBarEl.style.background = mColor; }
				if (mLblEl) mLblEl.textContent = Math.round(mUsed/1024) + ' / ' + Math.round(mTotal/1024) + ' MB (' + mPct + '%)';
			});
		}

		/* Initial fan animation */
		updateFanAnimation(pwm);

		poll.add(updateStatus, 3);

		return node;
	},

	handleSave:      null,
	handleSaveApply: null,
	handleReset:     null
});
