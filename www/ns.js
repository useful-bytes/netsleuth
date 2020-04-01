

var list = $('#targets');
var ws;
var hosts = {};

function connect() {
	ws = new WebSocket('ws://' + location.host + '/targets');
	ws.onopen = function() {
		$('#disc').hide();

		fetch('/ipc/setup').then(function(res) {
			res.json().then(function(status) {
				var items = 0;
				$('#syssetupwait').hide();
				$('#syssetupgo').attr('disabled', false);
				$('#syssetuplist li').hide();
				if (status.authbindInstalled === null) $('#syssetupprivport').hide();
				if (status.authbindInstalled === false) {
					++items;
					if (status.pkg) $('#syssetupautoab').show();
					else $('#syssetupmanualab').show();
				}
				if (status.authbindConfigured === false) {
					++items;
					$('#syssetupabconfig').show();
				}
				if (!status.loopbackConfigured) {
					++items;
					$('#syssetuplbconfig').show();
				}
				if (!status.caCertInstalled && localStorage.ignoreCa !== 'true') {
					++items;
					$('#syssetupca').show();
				}
				$('#syssetup').vis(!status.ok && items > 0);
			});
		});
	};
	ws.onclose = function() {
		setTimeout(connect, 5000);
		$('#disc').show();
		list.empty();
	};
	ws.onmessage = function(e) {
		var msg = JSON.parse(e.data);
		
		if (msg.m == 'init') {
			list.empty();
			if (msg.inspectors && msg.inspectors.length) msg.inspectors.forEach(addHost);
		} else if (msg.m == 'new') {
			addHost(msg);
		} else if (msg.m == 'rm') {
			$(document.getElementById('t-' + msg.host)).remove();
			delete hosts[msg.host];
		}
		listUpdated();
	}
}
connect();

function listUpdated() {
	var n = list.children('li').length
	$('#empty').vis(n == 0);
	$('#getstart').vis(n < 2);
}

function addHost(h) {
	var li = $('<li>').attr('id', 't-' + h.host),
		a = $('<a>').attr({
			href: '/inspect/' + h.host,
			target: '_blank'
		}).appendTo(li),
		img = $('<img>').attr('src', '/inspect/' + h.host + '/favicon.ico').addClass('tico').on('error', badIcon).appendTo(a),
		h3 = $('<h3>').text(h.host).appendTo(a);

	if (h.type == 1) $('<img>').attr('src', '/img/cloud.svg').attr('title', 'Public gateway inspector').addClass('ttype').appendTo(a);
	if (h.type == 3) $('<img>').attr('src', '/img/proxy.svg').attr('title', 'Local reverse proxy inspector').addClass('ttype').appendTo(a);
	if (h.type == 4) $('<img>').attr('src', '/img/proxy.svg').attr('title', 'Local forward proxy inspector').addClass('ttype').appendTo(a);

	if (h.target) $('<span>').addClass('target').text('→ ' + h.target).appendTo(a);

	if (h.deletable !== false) $('<button>').addClass('rm').text('×').appendTo(a);

	li.appendTo(list);
	hosts[h.host] = h;
}

function badIcon() {
	$(this).attr('src', '/img/netsleuth.svg');
}


if (navigator.vendor != 'Google Inc.') $('#notchrome').show();

if (!localStorage.nsinit) {
	localStorage['networkLogColumns'] = '"{"name":{"visible":true,"title":"Name"},"method":{"visible":true,"title":"Method"},"status":{"visible":true,"title":"Status"},"protocol":{"visible":true,"title":"Protocol"},"scheme":{"visible":false,"title":"Scheme"},"domain":{"visible":false,"title":"Domain"},"remoteaddress":{"visible":false,"title":"Remote Address"},"type":{"visible":false,"title":"Type"},"initiator":{"visible":true,"title":"Initiator"},"cookies":{"visible":false,"title":"Cookies"},"setcookies":{"visible":false,"title":"Set Cookies"},"size":{"visible":true,"title":"Size"},"time":{"visible":true,"title":"Time"},"priority":{"visible":false,"title":"Priority"},"connectionid":{"visible":false,"title":"Connection ID"},"cache-control":{"visible":false,"title":"Cache-Control"},"connection":{"visible":false,"title":"Connection"},"content-encoding":{"visible":false,"title":"Content-Encoding"},"content-length":{"visible":false,"title":"Content-Length"},"etag":{"visible":false,"title":"ETag"},"keep-alive":{"visible":false,"title":"Keep-Alive"},"last-modified":{"visible":false,"title":"Last-Modified"},"server":{"visible":false,"title":"Server"},"vary":{"visible":false,"title":"Vary"},"waterfall":{"visible":false,"title":""}}';
	localStorage['networkShowSettingsToolbar'] = 'false';
	localStorage['networkLogLargeRows'] = 'true';
	localStorage['nsinit'] = 'true';
	localStorage['networkResourceTypeFilters'] = '{"all":true}';
	localStorage['request-info-formData-category-expanded'] = 'true';
	localStorage['network.group-by-frame'] = 'false';
	localStorage['sourcesPanelSplitViewState'] = '{"vertical":{"size":0,"showMode":"Both"}}';
	localStorage['consoleHistory'] = '["help"]';
	localStorage['request-info-queryString-category-expanded'] = 'true';
	localStorage['sourcesPanelNavigatorSplitViewState'] = '{"vertical":{"size":0,"showMode":"Both"}}';
	localStorage['networkBlockedPatterns'] = '[]';
	localStorage['networkPanelSidebarState'] = '{"vertical":{"size":0,"showMode":"OnlyMain"}}';
	localStorage['drawer-view-tabOrder'] = '{"console-view":10,"network.config":20,"network.blocked-urls":30}';
	localStorage['inspectorVersion'] = '28';
	localStorage['request-info-responseHeaders-category-expanded'] = 'true';
	localStorage['request-info-requestHeaders-category-expanded'] = 'true';
	localStorage['request-info-general-category-expanded'] = 'true';
	localStorage['console.sidebarSelectedFilter'] = '"message"';
	localStorage['drawer-view-closeableTabs'] = '{"network.blocked-urls":true,"network.config":true}';
	localStorage['uiTheme'] = '"systemPreferred"';
	localStorage['consoleShowSettingsToolbar'] = 'false';
	localStorage['messageLevelFilters'] = '{"verbose":true,"info":true,"warning":true,"error":true}';
	localStorage['drawer-view-selectedTab'] = '"console-view"';
	localStorage['console.sidebar.width'] = '{"vertical":{"size":0,"showMode":"OnlyMain"}}';
	localStorage['screencastEnabled'] = 'false';
	localStorage['Inspector.drawerSplitViewState'] = '{"horizontal":{"size":0,"showMode":"Both"}}';
	localStorage['releaseNoteVersionSeen'] = '28';
	localStorage['networkPanelSplitViewState'] = '{"vertical":{"size":0}}';
	localStorage['consolePins'] = '[]';
	localStorage['networkShowIssuesOnly'] = 'false';
	localStorage['request-info-requestPayload-category-expanded'] = 'true';
	localStorage['resourceWebSocketFrameSplitViewState'] = '{"horizontal":{"size":110}}';
	localStorage['panel-selectedTab'] = '"network"';
	localStorage['resourceViewTab'] = '"headers"';
	localStorage['networkLogShowOverview'] = 'true';
	localStorage['cacheDisabled'] = 'false';
	localStorage['networkPanelSplitViewWaterfall'] = '{"vertical":{"size":0}}';
}



$.fn.vis = function(v) {
	if (v) this.show();
	else this.hide();
};
var fcert, usefcert;
$('#add').click(function() {
	$('#main').addClass('disabled');
	$('#adddlg').show();
	atype();
	tlspick(false);
	$('#adddlg input, #adddlg select').trigger('change');
	$('#adddlg input:visible').eq(0).focus();
}).click();
$('#aclose').click(aclose);
function aclose() {
	$('#main').removeClass('disabled');
	$('#adddlg').hide();
}
$('input[name="attype"]').change(atype);
function atype() {
	var id = $('#attypepub').is(':checked') ? 'atpub' : 'atprox';
	atype.active = id;
	$('.atpub,.atprox').hide();
	$('#' + id).addClass('active');
	$('.' + id).show();
	$('#adddlg input').not('[name="attype"]').trigger('change');
	acsu();
}

$('#actarget').on('focus', function() {
	if (this.value == 'http://localhost:80') this.setSelectionRange(17,19);
});

$('#actemp').change(function() {
	$('#actempi').text(this.checked ?
		'This host will be automatically deleted at next restart' + ( atype.active == 'atpub' ?
			' and the public gateway will not reserve its name for you.' :
			'.'
		) :
		'This host will be saved to your config file' + (atype.active == 'atpub' ?
			' and its name will be exclusively reserved for you by the public gateway.' :
			'.'));

	$('.notemp').attr('disabled', this.checked).trigger('change');
	$('.notempl').toggleClass('disabled', this.checked);
	$('#acname').trigger('change');

});
$('#acstore').change(function() {
	$('#acstorei').text(this.checked && !this.disabled ?
		'The gateway will store requests when your machine is offline.' :
		'Clients will receive an error when your machine is offline.');
});
$('#acauth').change(function() {
	$('.acauth').vis(this.checked);
});
$('#actls').change(function() {
	$('#actlsi').text(this.disabled ? 'No TLS -- target is plain HTTP.' : {
		normal: 'netsleuth will fully validate the target\'s TLS certificate.',
		insecure: 'Danger! netsleuth will ignore TLS certificate errors.',
		ca: 'netsleuth will validate the target using a custom CA/self-signed certificate.'
	}[this.value])[this.value == 'insecure' ? 'addClass' : 'removeClass']('danger');
	$('#actlscar')[this.value == 'ca' ? 'show' : 'hide']();
});
$('#actlsget').click(function() {
	fcert = null;
	try {
		var u = parseTarget();
	} catch (ex) {
		return alert('Please enter a valid target URL.');
	}
	fetch('/ipc/cert/' + u.host, {
		mode: 'same-origin'
	}).then(function(res) {
		if (res.ok) {
			return res.json().then(function(cert) {
				if (cert.valid) {
					cclose();
					alert(u.host + ' uses a valid certificate signed by a public CA; there is no need to use Custom CA mode.');
				} else {
					fcert = cert.raw;
					$('#certdlg .loading').hide();
					$('#certdlg .done').show();
					$('#ctarget').text('https://' + u.host);
					$('#csubject').text(stringifyNameObject(cert.subject));
					$('#actlscasubject').text(stringifyNameObject(cert.subject));
					$('#cissuer').text(stringifyNameObject(cert.issuer));
					$('#csha1').text(cert.fingerprint);
					$('#csha256').text(cert.fingerprint256);
					$('#cexp').text(cert.valid_to);
				}
			});
		} else {
			throw new Error('Bad response');
		}
	}).catch(function(err) {
		cclose();
		alert('Unable to get the target server\'s TLS certificate.  Make sure it is running and reachable.');
	});
	$('#certdlg .loading').show();
	$('#certdlg .done').hide();
	$('#adddlg').addClass('disabled');
	$('#certdlg').show();
});

function tlspick(picked) {
	usefcert = picked;
	$('#actlscasel').vis(!picked);
	$('#actlscafetched').vis(picked);
}

$('#caccept').click(function() {
	tlspick(true);
	cclose();
});

$('#actlscasubjectclear').click(function() {
	tlspick(false);
});

var ipish = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
$('#acname').on('change', function() {
	var name = this.value,
		c = name.indexOf(':');
	if (c >= 0) name = name.substr(0, c);

	var ip = !name || ipish.test(name);
	var ok = !$('#actemp').is(':checked');

	var ck = $('#atproxhostsfile').attr('disabled', !ok || ip);
	$('label[for="atproxhostsfile"]').toggleClass('disabled', !ok || ip);
	ck.parent().attr('title' , ip ? 'IP addresses cannot be added to your HOSTS file.' : '');
	ck[0].checked = ok && !ip;
	acsu();
});

$('#actarget').on('change', function() {
	if (this.value.substr(0, 5) == 'http:') {
		$('#actls').val('normal').attr('disabled', true).trigger('change');

	} else {
		$('#actls').attr('disabled', false).trigger('change');
	}
});

$('#atproxhostsfile').on('change', acsu);

function stringifyNameObject(o) {
	var r = [];
	for (var k in o) r.push(k + '=' + o[k]);
	return r.join(', ');
}

function parseTarget() {
	var u = $('#actarget').val();
	if (u.substr(0, 2) == '//') u = new URL('https:' + u);
	else u = new URL(u);
	if (u.protocol != 'http:' && u.protocol != 'https:') throw new Error('Invalid protocol.');
	return u;
}

function acsu() {
	var hf = $('#atproxhostsfile');
	$('#acaddsu').vis(hf.is(':checked:enabled:visible'));
}

$('#acadd').click(function() {
	var opts = {};

	opts.host = $('#acname').val();

	opts.target = $('#actarget').val();
	try {
		parseTarget();
	} catch (ex) {
		return alert('Please enter a valid target URL.');
	}

	if ($('#actemp').is(':checked')) opts.temp = true;

	opts.serviceOpts = {};

	if ($('#acauth').is(':checked')) opts.serviceOpts.auth = {
		user: $('#acauthu').val(),
		pass: $('#acauthp').val()
	};

	if (atype.active == 'atprox') {
		opts.local = true;
		opts.hostsfile = $('#atproxhostsfile').is(':checked');
	} else {
		var dom = $('#acgateway').val();
		opts.gateway = domains[dom].name;
		opts.region = $('#acregion').val();
		opts.serviceOpts.store = $('#acstore').is(':checked');
		if (opts.host) opts.host = opts.host + '.' + dom;
		else opts.host = undefined;
	}

	var tls = $('#actls').val();
	if (tls == 'insecure') {
		opts.insecure = true;
		go();
	} else if (tls == 'ca') {
		if (usefcert) {
			opts.ca = [fcert];
			go();
		} else {
			var reader = new FileReader(),
				file = $('#actlsca')[0].files[0];

			if (!file) return alert('Please select a certificate file.');
			reader.onload = function() {
				if (reader.result.indexOf('-----BEGIN CERTIFICATE-----') == -1) {
					done();
					return alert('That file does not appear to be a certificate.  Certificates must be PEM-encoded.');
				}
				opts.ca = [reader.result];
				go();
			};
			reader.onerror = function() {
				done();
				alert('Unable to read certificate file.');
			};
			reader.readAsText(file);
		}
	} else go();


	$('#addctls').addClass('disabled');

	function go() {
		fetch('/ipc/add', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(opts)
		}).then(function(res) {
			done();
			if (res.ok) {
				$('#acname').val('');
				$('#actarget').val('http://localhost:80');
				aclose();
			} else {
				if (res.status == 402) {
					$('#adddlg').addClass('disabled');
					$('#paydlg').show();
				}
				else return res.json().then(function(err) {
					alert(err.message);
				});
			}
		}).catch(function(err) {
			done();
			console.error(err);
			alert('Unexpected error: ' + (err && err.message));
		});
	}
	function done() {
		$('#addctls').removeClass('disabled');
	}
});



$('#cclose,#ccancel').click(cclose);
function cclose() {
	$('#adddlg').removeClass('disabled');
	$('#certdlg').hide();
}


var did;
$('#targets').on('click', 'a button', function(e) {
	e.preventDefault();
	$('#main').addClass('disabled');
	$('#deldlg').show();
	did = $(e.target).parents('li').attr('id').substr(2);
	var host = hosts[did];
	$('#dico').attr('src', '/inspect/' + host.host + '/favicon.ico');
	$('#dhost').text(host.host);
});
$('#dclose,#dcancel').click(dclose);
function dclose() {
	$('#main').removeClass('disabled');
	$('#deldlg').hide();
}
$('#dico').on('error', badIcon);

$('#dok').click(function() {
	$('#deldlg').addClass('disabled');
	fetch('/ipc/rm', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			hosts: [hosts[did].host]
		})
	}).then(function(res) {
		$('#deldlg').removeClass('disabled');
		if (res.ok) {
			$('#deldlg').removeClass('disabled');
			dclose();
		} else throw new Error('Bad response.');
	}).catch(function(err) {
		alert('Unable to delete host.');
		$('#deldlg').removeClass('disabled');
	});
});


$('#payclose,#paycancel').click(payclose);
function payclose() {
	$('#adddlg').removeClass('disabled');
	$('#paydlg').hide();
}

$('#paylearn').click(function() {
	location.assign('https://netsleuth.io/gateway');
});

var gateways = {}, domains = {};
function updateGateways() {
	fetch('/ipc/gateways').then(function(res) {
		res.json().then(function(cfg) {
			var $gw = $('#acgateway'), hasLogin = false;
			$gw.empty();
			cfg.gateways.forEach(function(gw) {
				gateways[gw.name] = gw;
				if (gw.loggedIn) hasLogin = true;
				(gw.domains || [gw.name]).forEach(function(dom) {
					domains[dom] = gw;
					var opt = $('<option>').attr('value', dom).text('.' + dom);
					if (dom == cfg.default) opt.attr('selected', true);
					opt.appendTo($gw);
				});
			});
			$gw.trigger('change');

			$('.loggedin').vis(hasLogin);
			$('.loggedout').vis(!hasLogin);
		});
	});
}
updateGateways();

$('#acgateway').on('change', function() {
	var self = this,
		$r = $('#acregion').empty(),
		regions = domains[self.value].regions;

	if (regions) {
		regions.forEach(function(region) {
			var opt = $('<option>').attr('value', region).text(region);
			if (region == domains[self.value].defaultRegion) opt.attr('selected', true);
			opt.appendTo($r);
		});
	} else {
		$('<option>').attr('value', '').text('(default)').appendTo($r);
	}
});


$('#syssetupcay').on('change', function() {
	var items = $('#syssetup li:visible').length;
	$('#syssetupgo').attr('disabled', !(items > 1 || this.checked));
});
$('#syssetupclose').click(function() {
	$('#syssetup').hide();
	$('#showsetup').show();
});
$('#showsetup').click(function() {
	$('#showsetup').hide();
	$('#syssetup').show();
});
$('#syssetupgo').click(function() {
	var btn = $('#syssetupgo').attr('disabled', true),
		spinner = $('#syssetupwait').show();

	localStorage.ignoreCa = !$('#syssetupcay').is(':checked');

	fetch('/ipc/setup', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			ca: $('#syssetupcay').is(':checked')
		})
	}).then(function(res) {
		return res.json().then(function(result) {
			if (result.err) {
				alert(result.err);
				btn.attr('disabled', false);
				spinner.hide();
			} else {
				if (ws) {
					ws.onclose = null;
					ws.close();
					list.empty();
				}
				setTimeout(connect, 2000);
			}
		}).catch(function(err) {
			alert('Unexpected error.  ' + err.message);
			btn.attr('disabled', false);
			spinner.hide();
		});
	});
});