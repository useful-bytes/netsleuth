
Runtime._queryParamsObject.ws = location.host + location.pathname;
document.title = location.pathname.split('/')[2] + ' - Network Inspector';

InspectorFrontendHost.copyText = function(text) {
	SDK.targetManager._mainConnection.sendMessage(JSON.stringify({
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


SDK.GatewayModel = class extends SDK.SDKModel {
	constructor(target) {
		super(target);
		target.registerGatewayDispatcher(this);
		this.state = 0;
	}

	connectionState(state, message) {
		this.state = state;
		this.message = message;
		this.dispatchEventToListeners(SDK.GatewayModel.Events.ConnectionState);
	}

	securityState(insecure, message) {
		this.insecure = insecure;
		this.insecureMessage = message;
		this.dispatchEventToListeners(SDK.GatewayModel.Events.ConnectionState);
	}

	updateRequestBody(id, body) {
		var req = getReq(id);
		if (req) {
			req.requestFormData += body;
			req.dispatchEventToListeners(SDK.NetworkRequest.Events.RequestHeadersChanged);
		}
	}

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