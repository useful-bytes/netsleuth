

var list = $('#targets');
var ws;
var hosts = {};

function connect() {
	ws = new WebSocket('ws://' + location.host + '/targets');
	ws.onopen = function() {
		$('#disc').hide();	
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
			$('#t-' + hostid(msg.host)).remove();
			delete hosts[hostid(msg.host)];
		}
		listUpdated();
	}
}
connect();

function listUpdated() {
	if (list.children('li').length == 0) $('#empty').show();
	else $('#empty').hide();
}

function addHost(h) {
	var li = $('<li>').attr('id', 't-' + hostid(h.host)),
		a = $('<a>').attr({
			href: '/inspect/' + h.host,
			target: '_blank'
		}).appendTo(li),
		img = $('<img>').attr('src', '/inspect/' + h.host + '/favicon.ico').addClass('tico').on('error', badIcon).appendTo(a),
		h3 = $('<h3>').text(h.host).appendTo(a);

	if (h.type == 1) $('<img>').attr('src', '/img/cloud.svg').attr('title', 'Public gateway inspector').addClass('ttype').appendTo(a);
	if (h.type == 3) $('<img>').attr('src', '/img/proxy.svg').attr('title', 'Local proxy inspector').addClass('ttype').appendTo(a);

	if (h.target) $('<span>').addClass('target').text('→ ' + h.target).appendTo(a);

	$('<button>').addClass('rm').text('×').appendTo(a);

	li.appendTo(list);
	hosts[hostid(h.host)] = h;
}

function badIcon() {
	$(this).attr('src', '/img/netsleuth.svg');
}

var space = /\s/g,
	dot = /\./g;
function hostid(name) {
	return name.replace(space, '-').replace(dot, '_');
}

if (navigator.vendor != 'Google Inc.') $('#notchrome').show();

if (!localStorage.nsinit) {
	localStorage['Inspector.drawerSplitViewState'] = '{"horizontal":{"size":0,"showMode":"Both"}}';
	localStorage.experiments = '{}';
	localStorage.inspectorVersion = '25';
	localStorage['network.group-by-frame'] = 'false';
	localStorage.networkLogColumns = '{"name":{"visible":true,"title":"Name"},"method":{"visible":true,"title":"Method"},"status":{"visible":true,"title":"Status"},"protocol":{"visible":true,"title":"Protocol"},"scheme":{"visible":false,"title":"Scheme"},"domain":{"visible":false,"title":"Domain"},"remoteaddress":{"visible":false,"title":"Remote Address"},"type":{"visible":false,"title":"Type"},"initiator":{"visible":true,"title":"Initiator"},"cookies":{"visible":false,"title":"Cookies"},"setcookies":{"visible":false,"title":"Set Cookies"},"size":{"visible":true,"title":"Size"},"time":{"visible":true,"title":"Time"},"priority":{"visible":false,"title":"Priority"},"connectionid":{"visible":false,"title":"Connection ID"},"cache-control":{"visible":false,"title":"Cache-Control"},"connection":{"visible":false,"title":"Connection"},"content-encoding":{"visible":false,"title":"Content-Encoding"},"content-length":{"visible":false,"title":"Content-Length"},"etag":{"visible":false,"title":"ETag"},"keep-alive":{"visible":false,"title":"Keep-Alive"},"last-modified":{"visible":false,"title":"Last-Modified"},"server":{"visible":false,"title":"Server"},"vary":{"visible":false,"title":"Vary"},"waterfall":{"visible":false,"title":""}}';
	localStorage.networkLogLargeRows = 'true';
	localStorage.networkLogShowOverview = 'true';
	localStorage.networkPanelSplitViewState = '{"vertical":{"size":0}}';
	localStorage.networkPanelSplitViewWaterfall = '{"vertical":{"size":0}}';
	localStorage['panel-selectedTab'] = '"network"';
	localStorage['request-info-formData-category-expanded'] = 'true';
	localStorage['request-info-general-category-expanded'] = 'true';
	localStorage['request-info-queryString-category-expanded'] = 'true';
	localStorage['request-info-requestHeaders-category-expanded'] = 'true';
	localStorage['request-info-requestPayload-category-expanded'] = 'true';
	localStorage['request-info-responseHeaders-category-expanded'] = 'true';
	localStorage.resourceViewTab = '"headers"';
	localStorage.nsinit = true;
}



$.fn.vis = function(v) {
	if (v) this.show();
	else this.hide();
};
var fcert, usefcert;
$('#add').click(function() {
	$('#main').addClass('disabled');
	$('#adddlg').show();
	atab('atpub');
	tlspick(false);
	$('#adddlg input, #adddlg select').trigger('change');
	$('#adddlg input:visible').eq(0).focus();
});
$('#aclose').click(aclose);
function aclose() {
	$('#main').removeClass('disabled');
	$('#adddlg').hide();
}
$('#atabs img').click(function() {
	atab(this.id);
});
function atab(id) {
	atab.active = id;
	$('.atpub,.atprox').hide();
	$('#atabs img').removeClass('active');
	$('#' + id).addClass('active');
	$('.' + id).show();
}

$('#actarget').on('focus', function() {
	if (this.value == 'http://localhost:80') this.setSelectionRange(17,19);
});

$('#acreserve').change(function() {
	$('#acreservei').text(this.checked ?
		'Reserved hostnames are saved for you until you release them.' :
		'Unreserved hostnames are released when you go offline.');
});
$('#acstore').change(function() {
	$('#acstorei').text(this.checked ?
		'The gateway will store requests when your machine is offline.' :
		'Clients will receive an error when your machine is offline.');
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
				$('#cvalid').text(cert.valid ? 'This certificate is valid and signed by a trusted CA.  You should not need to use Custom CA mode; Normal mode should work fine.' : 'Does not validate against public CAs');
			});
		} else {
			throw new Error('Bad response');
		}
	}).catch(function(err) {
		alert('Unable to get the target server\'s TLS certificate.  Make sure it is running and reachable.');
		cclose();
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

$('#actarget').on('change', function() {
	if (this.value.substr(0, 5) == 'http:') {
		$('#actls').val('normal').attr('disabled', true).trigger('change');

	} else {
		$('#actls').attr('disabled', false).trigger('change');
	}
});

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

$('#acadd').click(function() {
	var opts = {};

	opts.host = $('#acname').val();

	opts.target = $('#actarget').val();
	try {
		parseTarget();
	} catch (ex) {
		return alert('Please enter a valid target URL.');
	}

	if (atab.active == 'atprox') {
		if (!opts.host) return alert('Please enter a hostname.');
		opts.local = true;
		opts.hostsfile = $('#atproxhostsfile').is(':checked');
	} else {
		opts.gateway = 'netsleuth.io';
		opts.reserve = $('#acreserve').is(':checked');
		opts.store = $('#acstore').is(':checked');
		if (opts.host) opts.host = opts.host + '.netsleuth.io';
		else opts.host = undefined;
	}

	var tls = $('#actls').val();
	if (tls == 'insecure') opts.insecure = true;
	else if (tls == 'ca') {
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
				alert('oops');
			}
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