var contentTypeParser = require('content-type-parser');

function resourceType(contentType) {
	var ct = contentTypeParser(contentType);

	if (ct) {
		if (ct.subtype == 'javascript') return 'Script';
		if (ct.type == 'text' && ct.subtype == 'css') return 'Stylesheet';
		if (ct.type == 'text' && ct.subtype == 'html') return 'Document';
		if (ct.type == 'image') return 'Image';
		if (ct.type == 'audio' || ct.type == 'video') return 'Media';
		if (ct.type == 'font' || (ct.type == 'application' && (ct.subtype == 'otf' || ct.subtype.startsWith('font') || ct.subtype.startsWith('x-font')))) return 'Font';
	}

	return 'Other';

}

exports = module.exports = resourceType;
