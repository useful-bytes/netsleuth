
function charset(type) {
	// RFC 2616 says that the default charset for `text/*` is ISO-8859-1.
	// However, in practice, lots of content actually used/uses Windows-1252 ("Western").
	// 1252 is mostly similar to 8859-1 except 8859-1 reserves 0x7f - 0x9f as undefined, while 1252
	// assigns characters in that range.  The encodings are otherwise identical.
	// Thus, it is safe to treat ISO-8859-1 text as Windows-1252, and doing so allows mislabeled
	// content to be correctly interpreted.
	//
	// RFC 7213 obsoletes RFC 2616, and removes the default charset in favor of the media type definition.
	// However, many media types do not specify a default character encoding.
	//
	// So, in an effort to be maximally compatible, we:
	// 1. If an explicit `charset` directive is present, use it.
	// 2. If the mimetype has a default charset, use it. (unless it is 8859-1, in which case use 1252 for compatibility)
	// 3. If the mimetype is text/*, fall back to the legacy HTTP default.
	// 4. For all other mimetypes, we do not pick an encoding; treat it as binary data.

	if (!type) return null;

	var explicit = type.get('charset')
	if (explicit) {
		explicit = explicit.toLowerCase();
		if (explicit == 'iso-8859-1') return 'windows-1252';
		else return explicit;
	}

	var typeInfo = require('mime-db')[type.type + '/' + type.subtype];
	if (typeInfo && typeInfo.charset) return typeInfo.charset.toLowerCase();

	if (type.type == 'text') return 'windows-1252';

	return null;
}

exports = module.exports = charset;