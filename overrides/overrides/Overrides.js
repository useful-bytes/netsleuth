
Root.Runtime._queryParamsObject.set('ws',location.host + location.pathname);
document.title = location.pathname.split('/')[2] + ' - netsleuth';


function send(obj) {
	SDK.targetManager.mainTarget()._router._connection._socket.send(JSON.stringify(obj));
}

InspectorFrontendHost.copyText = function(text) {
	send({
		method: 'Clipboard.write',
		params: {
			text: text
		}
	});
};

InspectorFrontendHost.save = function(url, content, forceSaveAs) {
	console.log('save', url, content, forceSaveAs);
	Common.console.error('Sorry, not implemented.')
};

Help = {
	showReleaseNoteIfNeeded: function() {}
};


var gwModel;
SDK.GatewayModel = class extends SDK.SDKModel {
	constructor(target) {
		super(target);
		target.registerGatewayDispatcher(this);
		this.state = 0;
		gwModel = this;

		SDK.multitargetNetworkManager.addEventListener(SDK.MultitargetNetworkManager.Events.ConditionsChanged, ()=>this.updateIcon());
		SDK.multitargetNetworkManager.addEventListener(SDK.MultitargetNetworkManager.Events.BlockedPatternsChanged, ()=>this.updateIcon());
	}

	connectionState(state, message) {
		this.state = state;
		this.message = message;
		this.updateIcon();
		this.dispatchEventToListeners(SDK.GatewayModel.Events.ConnectionState);
	}

	securityState(insecure, message) {
		this.insecure = insecure;
		this.insecureMessage = message;
		this.updateIcon();
		this.dispatchEventToListeners(SDK.GatewayModel.Events.ConnectionState);
	}

	updateIcon() {
		var throttling = SDK.multitargetNetworkManager.isThrottling(),
			blocking = SDK.multitargetNetworkManager.isBlocking(),
			offline = SDK.multitargetNetworkManager.isOffline();


		var icon = null;
		if (this.state != 2) {
			icon = UI.Icon.create('smallicon-error');
			icon.title = this.message || 'Disconnected';
		} else if (throttling || blocking) {
			icon = UI.Icon.create('smallicon-warning');
			var msgs = [];
			if (offline) msgs.push('Offline mode -- all requests will be blocked');
			else if (throttling) msgs.push('Network throttling enabled');
			if (blocking) msgs.push('Request blocking enabled -- matching requests will be blocked');
			icon.title = msgs.join(', and ');

		} else if (this.insecure) {
			icon = UI.Icon.create('smallicon-orange-ball');
			icon.title = this.insecureMessage || 'Insecure';
		}
		if (UI.inspectorView) UI.inspectorView.setPanelIcon('network', icon);

	}

	// REQUEST body data received
	updateRequestBody(id, body, sentToDisk, file) {
		var req = getReq(id);
		if (req) {
			if (!req._requestFormData) req._requestFormData = '';
			if (sentToDisk) {
				req._requestFormData = '(file too large to display here; saved to ' + file + ')';
				req._nsreqBodyFile = file;
			} else {
				req._requestFormData += body;
			}
			req.setRequestFormData(true, req._requestFormData);
			req.dispatchEventToListeners(SDK.NetworkRequest.Events.RequestHeadersChanged);
		}
	}

	responseBodyLarge(id, file) {
		var req = getReq(id);
		req._nsresBodyFile = file;
	}

	// RESPONSE body data received
	dataReceived(requestId, chunk) {
		var req = getReq(requestId);
		if (req) {
			if (!req.__content) req.__content = [];
			req.__content.push(Base64Binary.decode(chunk));

			var len = 0;
			for (var i = 0; i < req.__content.length; i++) {
				len += req.__content[i].length;
			}
			var result = new Uint8Array(len), off = 0;
			for (var i = 0; i < req.__content.length; i++) {
				result.set(req.__content[i], off);
				off += req.__content[i].length;
			}
			req._contentData = Promise.resolve(new TextDecoder('utf-8').decode(result));
			req.dispatchEventToListeners(SDK.NetworkRequest.Events.RequestHeadersChanged);
		}
	}

	untrustedCert(cert) {
		console.log(cert);

		class UntrustedCertAlert extends UI.VBox {
		  constructor() {
			super(true);
			this.registerRequiredCSS('ui/remoteDebuggingTerminatedScreen.css');
			var message = this.contentElement.createChild('div', 'message');
			
			var err = message.createChild('span', 'reason');
			err.createChild('span').textContent = '⚠️ The server at ';
			err.createChild('span').textContent = cert.hostname;
			err.createChild('span').textContent = ' presented an untrusted certificate.';

			line('Subject:', cert.subject.CN);
			line('Issuer:', cert.issuer.CN);
			line('Issued:', cert.valid_from);
			line('Expires:', cert.valid_to);
			line('Fingerprint (SHA-1):', cert.fingerprint);
			line('Fingerprint (SHA-256):', cert.fingerprint256);

			var btns = message.createChild('div');

			btns.appendChild(UI.createTextButton('Reject for session', choice('reject')));
			btns.appendChild(UI.createTextButton('Accept for session', choice('session')));
			btns.appendChild(UI.createTextButton('Accept permanently', choice('perm')));

			function choice(op) {
				return function() {
					send({
						method: 'Gateway.setCertTrust',
						params: {
							hostname: cert.hostname,
							id: cert.id,
							op: op
						}
					});
					dialog.hide();
				}
			}

			function line(label, value) {
				var ln = message.createChild('div');
				ln.createChild('b').textContent = label + ' ';
				ln.createChild('span').textContent = value;
			}
		  }
		}

		var dialog = new UI.Dialog();
		dialog.setSizeBehavior(UI.GlassPane.SizeBehavior.MeasureContent);
		dialog.addCloseButton();
		new UntrustedCertAlert().show(dialog.contentElement);
		dialog.show();
	}

	close() {
		window.close();
	}
};

function getReq(id) {
	var mainTarget = SDK.targetManager.mainTarget();
	if (mainTarget) {
		var networkDispatcher = mainTarget._dispatchers.Network._dispatchers[0];
		if (networkDispatcher && networkDispatcher._inflightRequestsById[id]) {
			return networkDispatcher._inflightRequestsById[id];
		}
	}
}

SDK.SDKModel.register(SDK.GatewayModel, SDK.Target.Capability.Network, true);
SDK.GatewayModel.Events = {
	ConnectionState: Symbol('ConnectionState')
};

// There's probably a better way of doing this...
var patcher = setInterval(function() {
	if (window.Network && Network.RequestHeadersView) {
		clearInterval(patcher);
		var _populateTreeElementWithSourceText = Network.RequestHeadersView.prototype._populateTreeElementWithSourceText;
		Network.RequestHeadersView.prototype._populateTreeElementWithSourceText = function(treeElement, sourceText) {
			var self = this;
			_populateTreeElementWithSourceText.call(self, treeElement, sourceText);
			// debugger;
			if (self._request._nsreqBodyFile) {
				var div = createElementWithClass('div', '');

				var open = createElementWithClass('button', 'request-headers-show-more-button');
				open.textContent = 'Open file';
				open.addEventListener('click', function() {
					send({
						method: 'Gateway.openFile',
						params: {
							path: self._request._nsreqBodyFile
						}
					});
				});
				div.appendChild(open);

				var reveal = createElementWithClass('button', 'request-headers-show-more-button');
				reveal.textContent = 'Reveal file';
				reveal.addEventListener('click', function() {
					send({
						method: 'Gateway.revealFile',
						params: {
							path: self._request._nsreqBodyFile
						}
					});
				});
				div.appendChild(reveal);

				var copy = createElementWithClass('button', 'request-headers-show-more-button');
				copy.textContent = 'Copy path';
				copy.addEventListener('click', function() {
					send({
						method: 'Clipboard.write',
						params: {
							text: self._request._nsreqBodyFile
						}
					});
				});
				div.appendChild(copy);

				treeElement._children[0].titleElement.appendChild(div);
			}
		};

		var responseCreatePreview = Network.RequestResponseView.prototype.createPreview;
		Network.RequestResponseView.prototype.createPreview = async function() {
			if (this.request.failed) {
				return new UI.EmptyWidget('Request failed; no response.');
			} else if (this.request._nsresBodyFile) {
				return savedRes(this.request._nsresBodyFile);
			}
			else return responseCreatePreview.call(this);
		};
		var previewCreatePreview = Network.RequestPreviewView.prototype.createPreview;
		Network.RequestPreviewView.prototype.createPreview = async function() {
			if (this.request.failed) {
				return new UI.EmptyWidget('Request failed; no response.');
			} else if (this.request._nsresBodyFile) {
				return savedRes(this.request._nsresBodyFile);
			}
			else return previewCreatePreview.call(this);
		};


		var nrnRenderCell = Network.NetworkLogView.NetowrkRequestNode.prototype.renderCell;
		Network.NetworkLogView.NetowrkRequestNode.prototype.renderCell = function(cell, columnId) {
			nrnRenderCell.call(this, cell, columnId);
			if (columnId == 'name') {
				if (this._request._securityState == 'insecure') {
					var ico = createElement('img');
					ico.src = '/img/insecure.svg';
					ico.width = 14;
					ico.height = 14;
					ico.style.marginRight = '3px';
					ico.title = 'TLS validation failed: ' + this._request._securityDetails;
					cell.querySelector('.network-cell-subtitle').prepend(ico);
				}

			}
		};
	}
}, 100);

function savedRes(file) {
	var widget = new UI.EmptyWidget('Response too large to display here.');
	var info = widget._contentElement.createChild('div');
	info.createChild('b').textContent = 'Saved to: ';
	info.createChild('span').textContent = file;
	var btns = widget._contentElement.createChild('div');
	btns.style.margin = '10px 0 0';
	var open = btns.createChild('button');
	open.textContent = 'Open file';
	open.addEventListener('click', function() {
		send({
			method: 'Gateway.openFile',
			params: {
				path: file
			}
		});
	});
	btns.createChild('span').textContent = ' ';
	var reveal = btns.createChild('button');
	reveal.textContent = 'Reveal file';
	reveal.addEventListener('click', function() {
		send({
			method: 'Gateway.revealFile',
			params: {
				path: file
			}
		});
	});
	btns.createChild('span').textContent = ' ';
	var copy = btns.createChild('button');
	copy.textContent = 'Copy path';
	copy.addEventListener('click', function() {
		send({
			method: 'Clipboard.write',
			params: {
				text: file
			}
		});
	});
	return widget;
}


var Base64Binary = {
	_keyStr : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
	
	/* will return a  Uint8Array type */
	decodeArrayBuffer: function(input) {
		var bytes = (input.length/4) * 3;
		var ab = new ArrayBuffer(bytes);
		this.decode(input, ab);
		
		return ab;
	},

	removePaddingChars: function(input){
		var lkey = this._keyStr.indexOf(input.charAt(input.length - 1));
		if(lkey == 64){
			return input.substring(0,input.length - 1);
		}
		return input;
	},

	decode: function (input, arrayBuffer) {
		//get last chars to see if are valid
		input = this.removePaddingChars(input);
		input = this.removePaddingChars(input);

		var bytes = parseInt((input.length / 4) * 3, 10);
		
		var uarray;
		var chr1, chr2, chr3;
		var enc1, enc2, enc3, enc4;
		var i = 0;
		var j = 0;
		
		if (arrayBuffer)
			uarray = new Uint8Array(arrayBuffer);
		else
			uarray = new Uint8Array(bytes);
		
		input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");
		
		for (i=0; i<bytes; i+=3) {	
			//get the 3 octects in 4 ascii chars
			enc1 = this._keyStr.indexOf(input.charAt(j++));
			enc2 = this._keyStr.indexOf(input.charAt(j++));
			enc3 = this._keyStr.indexOf(input.charAt(j++));
			enc4 = this._keyStr.indexOf(input.charAt(j++));
	
			chr1 = (enc1 << 2) | (enc2 >> 4);
			chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
			chr3 = ((enc3 & 3) << 6) | enc4;
	
			uarray[i] = chr1;			
			if (enc3 != 64) uarray[i+1] = chr2;
			if (enc4 != 64) uarray[i+2] = chr3;
		}
	
		return uarray;	
	}
}

var favicon = new Image();
favicon.onload = function() {
	var canvas = document.createElement('canvas');
	canvas.width = 32;
	canvas.height = 32;
	var ctx = canvas.getContext('2d'),
		ratio = Math.min(32/favicon.width, 32/favicon.height),
		iw = favicon.width * ratio,
		ih = favicon.height * ratio;

	ctx.drawImage(favicon, 16-(iw/2), 16-(ih/2), iw, ih);

	var mag = new Image();
	mag.onload = function() {
	
		ctx.drawImage(mag, 13, 12, 19, 19);

		var lnk = document.createElement('link');
		lnk.rel = 'icon';
		lnk.href = canvas.toDataURL('image/png');
		document.head.appendChild(lnk);
	};
	mag.src = '/img/mag.svg';
};
favicon.src = location.href + '/favicon.ico';

NS = {
	reconnect: function() {
		if (gwModel) {
			gwModel.state = 3;
			gwModel.updateIcon();
		}
		fetch(location.href + '/health').then(function(res) {
			if (res.ok) window.location.reload();
			else setTimeout(NS.reconnect, 5000);
		}, function(err) {
			setTimeout(NS.reconnect, 5000);
		});
	}
};
