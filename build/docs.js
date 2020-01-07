var fs = require('fs'),
	path = require('path'),
	child_process = require('child_process'),
	MarkdownIt = require('markdown-it'),
	term = markdownItTerminal = require('markdown-it-terminal'),
	package = require('../package.json');

var mdfancy = new MarkdownIt();
mdfancy.use(term, {
	indent: '  '
});

var mdplain = new MarkdownIt();
var plain = { open: '', close: '' };
mdplain.use(term, {
	indent: '  ',
	styleOptions: {
		code: plain,
		blockquote: plain,
		html: plain,
		heading: plain,
		firstHeading: plain,
		hr: plain,
		listitem: plain,
		table: plain,
		paragraph: plain,
		strong: plain,
		em: plain,
		codespan: plain,
		del: plain,
		link: plain,
		href: plain
	}
});



function renderAll() {
	var dir = path.join(__dirname, '../docs'),
		outdir = path.join(__dirname, '../dist/docs/'),
		files = fs.readdirSync(dir),
		optTxt;

		
	if (process.argv[2]) {
		fs.writeFileSync(path.join(outdir, process.argv[2] + '.ansi'), renderDoc(mdfancy, path.join(dir, process.argv[2])));
		fs.writeFileSync(path.join(outdir, process.argv[2] + '.txt'), renderDoc(mdplain, path.join(dir, process.argv[2]), true));
	} else {
		require('../bin/req').yargs.showHelp(function(optTxt) {
			optTxt = optTxt.substr(optTxt.indexOf('\n\n')+2);
			
			fs.writeFileSync(path.join(outdir, 'req-options.txt'), optTxt);

			for (var file of files) {
				if (path.extname(file) == '.md') {
					fs.writeFileSync(path.join(outdir, file + '.ansi'), renderDoc(mdfancy, path.join(dir, file)));
					fs.writeFileSync(path.join(outdir, file + '.txt'), renderDoc(mdplain, path.join(dir, file), true));
				}
			}
		});

	}
	console.log('Rendered.');
}

var verex = /\$VERSION/;
function renderDoc(md, file) {
	var src = fs.readFileSync(file, 'utf-8');

	var rendered = md.render(src);
	rendered = rendered.replace(verex, package.version);

	return rendered;
}

function buildDoc(name, plain) {
	return renderDoc(plain ? mdplain : mdfancy, path.join(__dirname, '../docs', name + '.md'));
}

exports.buildDoc = buildDoc;
if (require.main === module) renderAll();