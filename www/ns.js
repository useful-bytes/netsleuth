

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
		}).appendTo(li)
		h3 = $('<h3>').text(h.host).appendTo(a);

	if (h.target) $('<span>').addClass('target').text(h.target).appendTo(a);

	li.appendTo(list);
}

var space = /\s/g,
	dot = /\./g;
function hostid(name) {
	return name.replace(space, '-').replace(dot, '_');
}

if (navigator.vendor != 'Google Inc.') $('#notchrome').show();