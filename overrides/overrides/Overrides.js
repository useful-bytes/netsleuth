
Root.Runtime._queryParamsObject.set('ws',location.host + location.pathname);
document.title = location.pathname.split('/')[2] + ' - netsleuth';

InspectorFrontendHost.copyText = function(text) {
	SDK.targetManager.mainTarget()._router._connection._socket.send(JSON.stringify({
		method: 'Clipboard.write',
		params: {
			text: text
		}
	}));
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
	updateRequestBody(id, body, sentToDisk) {
		var req = getReq(id);
		if (req) {
			if (!req._requestFormData) req._requestFormData = '';
			if (sentToDisk) {
				req._requestFormData += '\n\n…';
			} else {
				req._requestFormData += body;
			}
			req.setRequestFormData(true, req._requestFormData);
			req.dispatchEventToListeners(SDK.NetworkRequest.Events.RequestHeadersChanged);
		}
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
