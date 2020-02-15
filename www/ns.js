

var list = $('#targets');
var ws;
function connect() {
	ws = new WebSocket('ws://' + location.host + '/targets');
	ws.onclose = function() {
		setTimeout(connect, 5000);
	};
	ws.onmessage = function(e) {
		var msg = JSON.parse(e.data);
		
		if (msg.m == 'init' && msg.inspectors && msg.inspectors) {
			list.empty();
			msg.inspectors.forEach(addHost);
		} else if (msg.m == 'new') {
			addHost(msg);
		} else if (msg.m == 'rm') {
			$('#t-' + hostid(msg.host)).remove();
		}
	}
}
connect();

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

	li.appendTo(list);
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
