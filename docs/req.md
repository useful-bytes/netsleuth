netsleuth `req` v$VERSION is a better CLI tool for HTTP.  <https://netsleuth.io>

# Usage:
```
req [options] [method] <url> [<param>...]
req <command>
```

By default, req will print HTTP headers on stderr and the response body on stdout.  In addition, the request and response details will be sent to the netsleuth GUI, which is available at <http://localhost:9000/inspect/req-cli>

# Positional arguments:
## [method]
The HTTP request method.  Any uppercase word accepted.  Default: `GET` or `POST` depending on whether there is data to be sent in the request body.

## \<url>
The request URL.  May be fully-qualified, or use shorthand:
### Default to localhost
Without an explicit hostname, req will assume localhost.
```
req /foo -> http://127.0.0.1/foo
req :3000/foo -> http://127.0.0.1:3000/foo
```

### //
Shortcut for `http://`.
```
req //host/foo -> http://host/foo
```

### Named profile
req allows you to configure named profiles with a saved Origin URL, cookies, and default headers.  See the section on Profiles below.
```
req profilename/foo -> http://127.0.0.1:4000/foo
```

##
With fully-qualified URLs, you may also specify auth credentials using the standard URL auth notation.  Username + password credentials are sent using HTTP Basic auth.  If no password is specified, the username is sent as a Bearer token.
```
req http://user:pass@localhost/foo -> "Authorization: Basic dXNlcjpwYXNz"
req http://t0k3n@localhost/foo -> "Authorization: Bearer t0k3n"
```

### har:/path/to/file.har#entry
Use the special `har:` scheme to specify that req should make a request by replaying from a HAR file on disk (or `har:clip` to read the system clipboard).  Optionally use `entry` to specify the the request entry by index (default `0`).  Later params can override any properties loaded from the HAR.
```
req har:file.har bar=baz
```

## [param]...
Any number of additional space-separated parameters may be specified.  Values may be quoted as necessary.

### key=value _and_ key==value
The request body will be set to a JSON object with this key/value added.

- Use dot notation in the key for nested objects (`foo.bar=value`)
- Use `[]` to push primitive values to an array (`foo[]=1 foo[]=2`)
- Numeric values will be set as numbers
- `true`, `false`, and `null` will be set as booleans/null
- Anything else will be set as a string
- Keys and/or values with spaces must be enclosed with quotes
- Non-strings can be set as a string by using `==`
- Special param values can be escaped to string with `\`
```
req /foo n=1 a==1 b="x y" c=z -> {"n":1,"a":"1","b":"x y","c":"z"}
req /foo a=\\@a b=\\=b -> {"a":"@a","b":"=b"}
req /foo obj.a=1 obj.b=2 -> {"obj":{"a":1,"b":2}}
req /foo arr[]=1 arr[]=2 -> {"arr":[1,2]}
```

### key=@filepath
Reads and buffers this file and adds its content to the request body.  If the file can be parsed as JSON, the object itself is set on the property.  Otherwise, the raw contents are set as a string.
```
req /foo bar=@bar.json -> {"bar":{"from":"file"}}
req /foo bar=@bar.txt -> {"bar":"stuff from file"}
```

### ?key=value
URL parameters to be merged in to the request URL. (Useful to avoid shell-escaping `&`s and manual URL-encoding.)
```
req /foo ?q="bar baz" ?p=1 -> http://localhost/foo?q=bar%20baz&p=1
```

### Header:value
Adds a request header.
```
req /foo X-Signature:"xyz" -> X-Signature: xyz
```

### @filepath
The request body will be streamed from this file.  If a `Content-Type` header is not explicitly specified, req will try to guess based on file extension or fall back to `application/octet-stream`.  Cannot be mixed with `key=value` params.
```
req PUT /foo @~/example.json
```

### +namedPayload
If the \<url> uses a Profile, req will copy JSON properties saved in the Profile under this name to the request body.  Later params can override.  Assuming the "proj" Profile has a payload named "bar" with the value `{a:1, b:2, c:3}`:
```
req proj/foo +bar b=5 -> {"a":1,"b":5,"c":3}
```

### -- raw body
The text following `--` (and a space) will be transmitted as the request body.  req will not apply any modification to the text, but normal shell escaping rules apply.  Cannot be mixed with `key=value`, `@filepath`, or `+payload` params, but `Header:value` params may be specified **before** the `--`.

### --paste clipboard
If the `--paste` option is specified, req will use your system clipboard contents as the request body.  Only plain text is supported.  If the text parses as JSON, you may use `key=value` params to override keys in the pasted data.

# Profiles
req supports named profiles, which are a set of default options for a particular host.  This allows you to send saved headers with your requests, without having to specify them on the command line every time.

Profiles can be managed using the `req profile` command.  See `req profile --help` for more details.  Alternatively, manually edit `~/.sleuthrc`.

Use profiles by typing the profile name in place of the protocol+host part of the URL.  Any params on the command line override the profile's defaults.
```
req profilename/foo a=1
```

# Standard in/out
req prints most of its output on stderr; only the HTTP response body is printed to stdout.  This means shell pipes and redirection work exactly as one might expect.

```
req GET /page > page.html
req POST /upload -t jpg < cat.jpg
req /foo | req --txt /bar
```

If stdout is connected to a terminal, JSON responses are buffered, parsed, and pretty-printed.  Otherwise (or if `--raw` is set), the response is streamed out unmodified.

# Commands
Additional commands are available which manage req's configuration and environment.  Type `req <command> --help` for details of each command.

`profile`

# Options
$OPTIONS

Options may appear anywhere on the command line (before or after positional arguments).